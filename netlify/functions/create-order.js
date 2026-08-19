const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          success: false,
          error: "Method not allowed"
        })
      };
    }

    const body = JSON.parse(event.body || "{}");

    const amount = Number(body.amount);
    const customer = body.customer || {};
    const cart = body.cart || [];

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          success: false,
          error: "Invalid payment amount"
        })
      };
    }

    if (!cart.length) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          success: false,
          error: "Cart is empty"
        })
      };
    }

    if (!customer.name || !customer.phone || !customer.address) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          success: false,
          error: "Customer details are incomplete"
        })
      };
    }

    // Frontend amount is in INR.
    // Razorpay requires paise.
    const amountInPaise = Math.round(amount * 100);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: "POSTERLY_" + Date.now(),
      notes: {
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_address: customer.address
      }
    });

    console.log("POSTERLY Razorpay order created:", order);

    // IMPORTANT:
    // index.html expects this exact response structure.
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        key_id: process.env.RAZORPAY_KEY_ID,
        order: order
      })
    };

  } catch (error) {
    console.error("POSTERLY create-order error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: false,
        error: error?.error?.description ||
               error?.description ||
               error?.message ||
               "Unable to create Razorpay order"
      })
    };
  }
};
