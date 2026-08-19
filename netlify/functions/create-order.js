export default async (req) => {
  if (req.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(req.body || "{}");

    const amount = Number(body.amount);

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid amount" })
      };
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error("Razorpay environment variables are missing");

      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Razorpay server configuration is missing"
        })
      };
    }

    const auth = Buffer
      .from(`${keyId}:${keySecret}`)
      .toString("base64");

    const response = await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: Math.round(amount),
          currency: "INR",
          receipt: `posterly_${Date.now()}`,
          payment_capture: 1
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Razorpay error:", data);

      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: data.error?.description || "Could not create Razorpay order"
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        order: data
      })
    };

  } catch (error) {
    console.error("Create order error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Internal server error"
      })
    };
  }
};
