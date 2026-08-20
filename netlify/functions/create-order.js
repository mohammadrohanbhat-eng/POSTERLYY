const JSON_HEADERS = { "Content-Type": "application/json" };

function response(statusCode, data) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(data)
  };
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
    const amount = Number(body.amount);
    const customer = body.customer || {};
    const cart = Array.isArray(body.cart) ? body.cart : [];

    if (!Number.isFinite(amount) || amount <= 0) {
      return response(400, { success: false, error: "Invalid payment amount" });
    }

    if (!cart.length) {
      return response(400, { success: false, error: "Cart is empty" });
    }

    if (!customer.name || !customer.phone || !customer.address) {
      return response(400, {
        success: false,
        error: "Customer details are incomplete"
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
          customer_address: String(customer.address).slice(0, 250)
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
