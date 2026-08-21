const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

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

async function sendBrevoEmail({ toEmail, toName, subject, htmlContent, textContent }) {
  const apiKey = process.env.BREVO_API_KEY;
  const sellerEmail = process.env.SELLER_EMAIL;

  if (!apiKey || !sellerEmail) {
    throw new Error("Brevo email environment variables are missing.");
  }

  const payload = {
    sender: {
      name: "POSTERLY",
      email: sellerEmail
    },
    to: [
      {
        email: toEmail,
        name: toName || ""
      }
    ],
    subject,
    htmlContent,
    textContent
  };

  const result = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await result.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  if (!result.ok) {
    console.error("Brevo error:", result.status, data);
    throw new Error(
      data?.message ||
      data?.code ||
      "Brevo failed to send the email."
    );
  }

  return data;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return response(405, {
        success: false,
        error: "Method not allowed"
      });
    }

    const body = JSON.parse(event.body || "{}");

    const {
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      items,
      totalAmount,
      razorpayPaymentId,
      razorpayOrderId
    } = body;

    if (!customerEmail) {
      return response(400, {
        success: false,
        error: "Customer email is required."
      });
    }

    if (!razorpayPaymentId || !razorpayOrderId) {
      return response(400, {
        success: false,
        error: "Verified Razorpay payment details are required."
      });
    }

    const safeName = escapeHtml(customerName || "Customer");
    const safeEmail = escapeHtml(customerEmail);
    const safePhone = escapeHtml(customerPhone || "Not provided");
    const safeAddress = escapeHtml(customerAddress || "Not provided");
    const safePaymentId = escapeHtml(razorpayPaymentId);
    const safeOrderId = escapeHtml(razorpayOrderId);
    const safeTotal = escapeHtml(
      totalAmount !== undefined ? `₹${totalAmount}` : "Not provided"
    );

    let itemsHtml = "<p>No item details supplied.</p>";
    let itemsText = "No item details supplied.";

    if (Array.isArray(items) && items.length > 0) {
      itemsHtml = `
        <table style="width:100%;border-collapse:collapse;margin-top:15px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Item</th>
              <th style="text-align:center;border-bottom:1px solid #ddd;padding:8px;">Qty</th>
              <th style="text-align:right;border-bottom:1px solid #ddd;padding:8px;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;">
                  ${escapeHtml(item.name || item.title || "Poster")}
                </td>
                <td style="padding:8px;text-align:center;border-bottom:1px solid #eee;">
                  ${escapeHtml(item.quantity ?? 1)}
                </td>
                <td style="padding:8px;text-align:right;border-bottom:1px solid #eee;">
                  ₹${escapeHtml(item.price ?? "")}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;

      itemsText = items.map(item =>
        `- ${item.name || item.title || "Poster"} | Qty: ${item.quantity ?? 1} | Price: ₹${item.price ?? ""}`
      ).join("\n");
    }

    const sellerEmail = process.env.SELLER_EMAIL;

    /*
      EMAIL 1 — SELLER
    */
    const sellerHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
        <div style="max-width:650px;margin:auto;background:#ffffff;padding:25px;border-radius:12px;">
          <h1 style="margin-top:0;">🛍️ New POSTERLY Order</h1>

          <p style="color:#16803c;font-weight:bold;">
            PAYMENT CAPTURED
          </p>

          <hr>

          <h2>Customer</h2>
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p><strong>Phone:</strong> ${safePhone}</p>

          <h2>Delivery Address</h2>
          <p style="white-space:pre-line;">${safeAddress}</p>

          <h2>Order</h2>
          ${itemsHtml}

          <h2>Total Paid: ${safeTotal}</h2>

          <hr>

          <p><strong>Razorpay Order ID:</strong> ${safeOrderId}</p>
          <p><strong>Razorpay Payment ID:</strong> ${safePaymentId}</p>

          <div style="margin-top:25px;padding:15px;background:#fff4d6;border-radius:8px;">
            <strong>Next step:</strong> Prepare and ship this order.
          </div>
        </div>
      </body>
      </html>
    `;

    const sellerText = `
POSTERLY — NEW ORDER

PAYMENT CAPTURED

Customer:
Name: ${customerName || "Customer"}
Email: ${customerEmail}
Phone: ${customerPhone || "Not provided"}

Delivery Address:
${customerAddress || "Not provided"}

Items:
${itemsText}

Total Paid:
${totalAmount !== undefined ? `₹${totalAmount}` : "Not provided"}

Razorpay Order ID:
${razorpayOrderId}

Razorpay Payment ID:
${razorpayPaymentId}

Next step: Prepare and ship this order.
`;

    /*
      EMAIL 2 — CUSTOMER
    */
    const customerHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
        <div style="max-width:650px;margin:auto;background:#ffffff;padding:25px;border-radius:12px;">
          <h1 style="margin-top:0;">POSTERLY</h1>

          <h2>✅ Order Confirmed</h2>

          <p>Hi ${safeName},</p>

          <p>
            Your payment was successfully received and your POSTERLY order
            has been confirmed.
          </p>

          <div style="padding:15px;background:#eaf8ef;border-radius:8px;">
            <strong>Payment Status: PAID</strong>
          </div>

          <h2>Order Details</h2>
          ${itemsHtml}

          <h2>Total Paid: ${safeTotal}</h2>

          <h3>Delivery Address</h3>
          <p style="white-space:pre-line;">${safeAddress}</p>

          <hr>

          <p>
            <strong>Order ID:</strong> ${safeOrderId}
          </p>

          <p>
            <strong>Payment ID:</strong> ${safePaymentId}
          </p>

          <div style="margin-top:25px;padding:15px;background:#f1f1f1;border-radius:8px;">
            <strong>Shipping status:</strong> Preparing to ship
          </div>

          <p style="margin-top:25px;">
            Thank you for ordering from POSTERLY.
          </p>
        </div>
      </body>
      </html>
    `;

    const customerText = `
POSTERLY — ORDER CONFIRMED

Hi ${customerName || "Customer"},

Your payment was successfully received and your order has been confirmed.

Payment Status: PAID

Items:
${itemsText}

Total Paid:
${totalAmount !== undefined ? `₹${totalAmount}` : "Not provided"}

Delivery Address:
${customerAddress || "Not provided"}

Order ID:
${razorpayOrderId}

Payment ID:
${razorpayPaymentId}

Shipping status:
Preparing to ship

Thank you for ordering from POSTERLY.
`;

    /*
      Send seller email first.
    */
    const sellerResult = await sendBrevoEmail({
      toEmail: sellerEmail,
      toName: "POSTERLY Seller",
      subject: `🛍️ New POSTERLY Order — ${razorpayOrderId}`,
      htmlContent: sellerHtml,
      textContent: sellerText
    });

    /*
      Then send customer confirmation.
    */
    const customerResult = await sendBrevoEmail({
      toEmail: customerEmail,
      toName: customerName || "Customer",
      subject: `✅ POSTERLY Order Confirmed — ${razorpayOrderId}`,
      htmlContent: customerHtml,
      textContent: customerText
    });

    console.log("POSTERLY emails sent:", {
      sellerMessageId: sellerResult?.messageId,
      customerMessageId: customerResult?.messageId,
      razorpayPaymentId,
      razorpayOrderId
    });

    return response(200, {
      success: true,
      sellerEmailSent: true,
      customerEmailSent: true
    });

  } catch (error) {
    console.error("POSTERLY email error:", error);

    return response(500, {
      success: false,
      error: error?.message || "Could not send order emails."
    });
  }
};
