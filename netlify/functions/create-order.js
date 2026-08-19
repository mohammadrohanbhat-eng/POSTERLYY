const Razorpay = require("razorpay");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: {"Content-Type":"application/json"},
        body: JSON.stringify({success:false,error:"Method not allowed"}) };
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch {
      return { statusCode:400, headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Invalid JSON body"}) };
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { statusCode:400, headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Invalid amount"}) };
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return { statusCode:500, headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Razorpay environment variables are not configured"}) };
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

    const order = await razorpay.orders.create(options);

    console.log("Razorpay order created:", {
      id: order.id, amount: order.amount, currency: order.currency
    });

    return {
      statusCode:200,
      headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
      body:JSON.stringify({
        success:true,
        key_id:process.env.RAZORPAY_KEY_ID,
        order
      })
    };
  } catch (error) {
    console.error("Razorpay order creation error:", error);
    return {
      statusCode:500,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        success:false,
        error:error?.error?.description || error?.message || "Could not create Razorpay order"
      })
    };
  }
};
