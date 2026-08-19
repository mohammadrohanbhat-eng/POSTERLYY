const Razorpay = require("razorpay");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Method not allowed"
        })
      };
    }

    const body = JSON.parse(event.body || "{}");

    const amount = Number(body.amount);

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Invalid amount"
        })
      };
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const options = {
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `posterly_${Date.now()}`
    };

    console.log("Creating Razorpay order:", options);

    const order = await razorpay.orders.create(options);

    console.log("Razorpay order created:", order);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        order: order
      })
    };

  } catch (error) {
    console.error("Razorpay order creation error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
     body: JSON.stringify({
  success: true,
  key_id: process.env.RAZORPAY_KEY_ID,
  order: order
})
    };
  }
};
