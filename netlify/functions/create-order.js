const crypto = require("crypto");

exports.handler = async function(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error("Missing Razorpay environment variables");
      return json(500, { error: "Razorpay server keys are not configured in Netlify." });
    }

    const body = JSON.parse(event.body || "{}");
    const amountRupees = Number(body.amount);

    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return json(400, { error: "Invalid amount." });
    }

    const amount = Math.round(amountRupees * 100);

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: "posterly_" + Date.now(),
        notes: {
          customer_name: String(body.name || "").slice(0, 100),
          phone: String(body.phone || "").slice(0, 30)
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Razorpay order error:", JSON.stringify(data));
      return json(response.status, {
        error: data?.error?.description || "Razorpay rejected the order request."
      });
    }

    console.log("Razorpay order created:", data.id, "amount:", data.amount);

    return json(200, {
      orderId: data.id,
      amount: data.amount,
      currency: data.currency
    });
  } catch (error) {
    console.error("create-order error:", error);
    return json(500, { error: error.message || "Could not create Razorpay order." });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}