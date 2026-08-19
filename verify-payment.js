
const crypto = require("crypto");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return json(500, { error: "Razorpay secret is not configured." });

  try {
    const body = JSON.parse(event.body || "{}");
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json(400, { error: "Missing Razorpay verification fields." });
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(razorpay_signature), "utf8");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return json(400, { success: false, error: "Payment verification failed." });
    }

    // At this point the browser result has been cryptographically verified.
    // Add persistent storage/email/fulfilment here when ready.
    return json(200, {
      success: true,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      message: "Payment verified successfully."
    });
  } catch (e) {
    console.error(e);
    return json(500, { success: false, error: "Verification server error." });
  }
};
