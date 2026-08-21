const JSON_HEADERS = { "Content-Type": "application/json" };

function response(statusCode, data) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(data)
  };
}

const POSTER_PRICE = 15;
const PACK_PRICE = 80;
const INDIVIDUAL_SHIPPING = 49;
const POSTER_COUNT = 12;
const PACK_ID = "legends-mix";

function calculateServerTotal(cart) {
  if (!Array.isArray(cart) || !cart.length) throw new Error("Cart is empty");

  let subtotal = 0;
  let hasPack = false;

  for (const item of cart) {
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      throw new Error("Invalid item quantity");
    }

    if (item.type === "pack") {
      if (item.id && item.id !== PACK_ID) throw new Error("Invalid pack");
      if (qty > 99) throw new Error("Invalid pack quantity");
      hasPack = true;
      subtotal += PACK_PRICE * qty;
    } else if (item.type === "poster") {
      const index = Number(item.i);
      if (!Number.isInteger(index) || index < 0 || index >= POSTER_COUNT) {
        throw new Error("Invalid poster");
      }
      subtotal += POSTER_PRICE * qty;
    } else {
      throw new Error("Invalid cart item");
    }
  }

  const shipping = hasPack ? 0 : INDIVIDUAL_SHIPPING;
  return { subtotal, shipping, total: subtotal + shipping };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return response(405, { success: false, error: "Method not allowed" });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return response(500, {
        success: false,
        error: "Razorpay keys are not configured in Netlify."
      });
    }

    const body = JSON.parse(event.body || "{}");
    const customer = body.customer || {};
    if (typeof customer.pin === "string") {
      customer.pin = customer.pin.replace(/\s+/g, "");
    }
    const cart = Array.isArray(body.cart) ? body.cart : [];

    let pricing;
    try {
      pricing = calculateServerTotal(cart);
    } catch (pricingError) {
      return response(400, {
        success: false,
        error: pricingError.message || "Invalid cart"
      });
    }

    // The browser's amount is deliberately ignored.
    const amount = pricing.total;

    if (!customer.name || !customer.phone || !customer.email || !customer.address || !customer.state || !customer.pin) {
      return response(400, {
        success: false,
        error: "Customer details are incomplete"
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(String(customer.email))) {
      return response(400, {
        success: false,
        error: "Invalid customer email"
      });
    }

    if (!/^\d{6}$/.test(String(customer.pin))) {
      return response(400, {
        success: false,
        error: "Invalid customer PIN code"
      });
    }

    const amountInPaise = Math.round(amount * 100);
    if (amountInPaise < 100) {
      return response(400, {
        success: false,
        error: "Minimum payment amount is ₹1"
      });
    }

    // Use Razorpay's HTTPS API directly. This avoids requiring the
    // "razorpay" npm module inside the Netlify Function bundle.
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const rp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        receipt: `POSTERLY_${Date.now()}`,
        notes: {
          customer_name: String(customer.name).slice(0, 250),
          customer_phone: String(customer.phone).slice(0, 250),
          customer_address: String(customer.address).slice(0, 250),
          customer_email: String(customer.email).slice(0, 250),
          customer_state: String(customer.state).slice(0, 100),
          customer_pin: String(customer.pin).slice(0, 20)
        }
      })
    });

    const raw = await rp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: { description: raw || "Invalid Razorpay response" } };
    }

    if (!rp.ok) {
      console.error("Razorpay order creation failed:", rp.status, data);
      return response(502, {
        success: false,
        error:
          data?.error?.description ||
          data?.description ||
          "Razorpay could not create the order."
      });
    }

    console.log("POSTERLY Razorpay order created:", data.id);

    return response(200, {
      success: true,
      key_id: keyId,
      order: data
    });
  } catch (error) {
    console.error("POSTERLY create-order error:", error);
    return response(500, {
      success: false,
      error: error?.message || "Unable to create Razorpay order"
    });
  }
};
