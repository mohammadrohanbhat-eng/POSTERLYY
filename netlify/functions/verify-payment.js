const crypto = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json"
};

function response(statusCode, data) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(data)
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  return `₹${Number(value || 0).toFixed(0)}`;
}

function orderLines(items) {
  if (!Array.isArray(items) || !items.length) {
    return "<p>No item details supplied.</p>";
  }

  return items.map(item => {
    const qty = Number(item.qty || 1);
    const price = Number(item.price || 0);

    if (item.type === "pack") {
      const contents = Array.isArray(item.contents) && item.contents.length
        ? `<ul>${item.contents.map(x => `<li>${escapeHtml(x)} × 1</li>`).join("")}</ul>`
        : "<p>No pack contents listed.</p>";

      return `
        <div style="padding:12px 0;border-bottom:1px solid #ddd">
          <strong>${escapeHtml(item.name)}</strong> × ${qty}
          <span style="float:right">${money(price * qty)}</span>
          <div style="margin-top:6px;color:#555">
            Pack contents:
            ${contents}
          </div>
        </div>`;
    }

    return `
      <div style="padding:12px 0;border-bottom:1px solid #ddd">
        <strong>${escapeHtml(item.name)}</strong> × ${qty}
        <span style="float:right">${money(price * qty)}</span>
      </div>`;
  }).join("");
}

async function sendBrevoEmail({ apiKey, senderEmail, senderName, toEmail, toName, subject, htmlContent }) {
  const result = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName
      },
      to: [{
        email: toEmail,
        name: toName || toEmail
      }],
      subject,
      htmlContent
    })
  });

  const raw = await result.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!result.ok) {
    throw new Error(data?.message || data?.error || `Brevo returned HTTP ${result.status}`);
  }

  return data;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return response(405, { success: false, error: "Method not allowed" });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const brevoApiKey = process.env.BREVO_API_KEY;
    const sellerEmail = process.env.SELLER_EMAIL;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || sellerEmail;
    const senderName = process.env.BREVO_SENDER_NAME || "POSTERLY";

    if (!keyId || !secret) {
      return response(500, {
        success: false,
        error: "Razorpay keys are not configured in Netlify."
      });
    }

    const body = JSON.parse(event.body || "{}");

    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = body;

    const customer = body.customer || {};
    const cart = Array.isArray(body.cart) ? body.cart : [];
    const items = Array.isArray(body.cartDetails) ? body.cartDetails : [];
    const shipping = Number(body.shipping || 0);
    const frontendTotal = Number(body.total || 0);

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return response(400, {
        success: false,
        error: "Missing payment verification fields"
      });
    }

    if (!customer.name || !customer.phone || !customer.email ||
        !customer.address || !customer.state || !customer.pin) {
      return response(400, {
        success: false,
        error: "Customer details are incomplete"
      });
    }

    // Verify Razorpay's signature.
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(razorpay_signature, "utf8");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return response(400, {
        success: false,
        error: "Invalid payment signature"
      });
    }

    // Confirm the actual payment with Razorpay.
    const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");

    const rp = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` }
      }
    );

    const raw = await rp.text();
    let payment;
    try {
      payment = JSON.parse(raw);
    } catch {
      payment = null;
    }

    if (!rp.ok || !payment) {
      console.error("Could not fetch payment:", rp.status, payment);
      return response(502, {
        success: false,
        error: "Could not confirm payment status with Razorpay."
      });
    }

    if (payment.order_id !== razorpay_order_id) {
      return response(400, {
        success: false,
        error: "Payment does not belong to this order."
      });
    }

    // NEVER send a paid-order email unless Razorpay says CAPTURED.
    if (payment.status !== "captured") {
      return response(402, {
        success: false,
        verified: false,
        captured: false,
        payment_status: payment.status,
        error: `Payment is not captured. Current status: ${payment.status}`
      });
    }

    const paidTotal = Number(payment.amount || 0) / 100;

    // Recalculate the expected amount from the cart on the server.
    const POSTER_PRICE = 15;
    const PACK_PRICE = 80;
    const INDIVIDUAL_SHIPPING = 49;
    let expectedSubtotal = 0;
    let hasPack = false;

    for (const item of cart) {
      const qty = Number(item?.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
        return response(400, { success: false, error: "Invalid cart quantity" });
      }

      if (item.type === "pack") {
        if (item.id && item.id !== "legends-mix") {
          return response(400, { success: false, error: "Invalid pack" });
        }
        if (qty > 99) {
          return response(400, { success: false, error: "Invalid pack quantity" });
        }
        hasPack = true;
        expectedSubtotal += PACK_PRICE * qty;
      } else if (item.type === "poster") {
        const index = Number(item.i);
        if (!Number.isInteger(index) || index < 0 || index >= 12) {
          return response(400, { success: false, error: "Invalid poster" });
        }
        expectedSubtotal += POSTER_PRICE * qty;
      } else {
        return response(400, { success: false, error: "Invalid cart item" });
      }
    }

    const expectedTotal = expectedSubtotal + (hasPack ? 0 : INDIVIDUAL_SHIPPING);

    if (paidTotal !== expectedTotal) {
      return response(400, {
        success: false,
        verified: true,
        captured: true,
        error: `Paid amount ₹${paidTotal.toFixed(0)} does not match the server-calculated order total ₹${expectedTotal.toFixed(0)}.`
      });
    }

    const orderId = `PL${Date.now()}`;

    let emailStatus = {
      configured: Boolean(brevoApiKey && senderEmail && sellerEmail),
      seller: false,
      customer: false
    };

    if (brevoApiKey && senderEmail && sellerEmail) {
      const itemsHtml = orderLines(items);
      const deliveryText = shipping === 0 ? "FREE" : money(shipping);
      const totalText = money(paidTotal || frontendTotal);

      const sellerHtml = `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#111">
          <h1>POSTERLY — NEW PAID ORDER</h1>
          <p><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>
          <p><strong>Payment:</strong> PAID / CAPTURED</p>

          <h2>Customer Details</h2>
          <p>
            <strong>Name:</strong> ${escapeHtml(customer.name)}<br>
            <strong>Phone:</strong> ${escapeHtml(customer.phone)}<br>
            <strong>Email:</strong> ${escapeHtml(customer.email)}<br>
            <strong>Address:</strong> ${escapeHtml(customer.address)}<br>
            <strong>State:</strong> ${escapeHtml(customer.state)}<br>
            <strong>PIN:</strong> ${escapeHtml(customer.pin)}
          </p>

          <h2>Items to Ship</h2>
          ${itemsHtml}

          <h2>Payment Summary</h2>
          <p>
            <strong>Delivery:</strong> ${deliveryText}<br>
            <strong>Total Paid:</strong> ${totalText}<br>
            <strong>Razorpay Order ID:</strong> ${escapeHtml(razorpay_order_id)}<br>
            <strong>Razorpay Payment ID:</strong> ${escapeHtml(razorpay_payment_id)}
          </p>
        </div>`;

      const customerHtml = `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#111">
          <h1>POSTERLY — ORDER CONFIRMED</h1>
          <p>Hi ${escapeHtml(customer.name)},</p>
          <p>Your payment was successfully received and your order is confirmed.</p>

          <p><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>

          <h2>Your Items</h2>
          ${itemsHtml}

          <h2>Payment</h2>
          <p>
            <strong>Delivery:</strong> ${deliveryText}<br>
            <strong>Total Paid:</strong> ${totalText}<br>
            <strong>Status:</strong> PAID
          </p>

          <h2>Delivery Address</h2>
          <p>
            ${escapeHtml(customer.address)}<br>
            ${escapeHtml(customer.state)} — ${escapeHtml(customer.pin)}
          </p>

          <p>Your order is now being prepared for shipping.</p>
          <p>Thank you for shopping with POSTERLY.</p>
        </div>`;

      try {
        await sendBrevoEmail({
          apiKey: brevoApiKey,
          senderEmail,
          senderName,
          toEmail: sellerEmail,
          toName: "POSTERLY Seller",
          subject: `POSTERLY — PAID ORDER ${orderId}`,
          htmlContent: sellerHtml
        });
        emailStatus.seller = true;
      } catch (emailError) {
        console.error("Seller email failed:", emailError);
      }

      try {
        await sendBrevoEmail({
          apiKey: brevoApiKey,
          senderEmail,
          senderName,
          toEmail: String(customer.email),
          toName: String(customer.name),
          subject: `POSTERLY — Order ${orderId} Confirmed`,
          htmlContent: customerHtml
        });
        emailStatus.customer = true;
      } catch (emailError) {
        console.error("Customer email failed:", emailError);
      }
    }

    console.log("POSTERLY payment verified and captured:", {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      amount: payment.amount,
      emailStatus
    });

    return response(200, {
      success: true,
      verified: true,
      captured: true,
      payment_status: "captured",
      amount: payment.amount,
      currency: payment.currency,
      razorpay_payment_id,
      razorpay_order_id,
      posterly_order_id: orderId,
      email_status: emailStatus
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    return response(500, {
      success: false,
      error: error?.message || "Payment verification failed"
    });
  }
};
