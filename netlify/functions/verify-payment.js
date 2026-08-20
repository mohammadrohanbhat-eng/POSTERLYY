const crypto = require("crypto");

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
    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !secret) {
      return response(500, {
        success: false,
        error: "Razorpay keys are not configured in Netlify."
      });
    }

    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = JSON.parse(event.body || "{}");

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return response(400, {
        success: false,
        error: "Missing payment verification fields"
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

    // A valid signature alone is NOT enough to confirm an order.
    // Fetch the real payment from Razorpay and require "captured".
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

    // NEVER confirm POSTERLY orders unless Razorpay says CAPTURED.
    if (payment.status !== "captured") {
      console.warn("Payment is not captured:", {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        status: payment.status
      });

      return response(402, {
        success: false,
        verified: false,
        captured: false,
        payment_status: payment.status,
        error: `Payment is not captured. Current status: ${payment.status}`
      });
    }

    console.log("POSTERLY payment verified and captured:", {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      amount: payment.amount
    });

    return response(200, {
      success: true,
      verified: true,
      captured: true,
      payment_status: "captured",
      amount: payment.amount,
      currency: payment.currency,
      razorpay_payment_id,
      razorpay_order_id
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    return response(500, {
      success: false,
      error: error?.message || "Payment verification failed"
    });
  }
};
