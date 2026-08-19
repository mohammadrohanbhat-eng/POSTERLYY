const crypto = require("crypto");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {statusCode:405,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Method not allowed"})};
    }

    const {razorpay_payment_id,razorpay_order_id,razorpay_signature} =
      JSON.parse(event.body || "{}");

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return {statusCode:400,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Missing payment verification fields"})};
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return {statusCode:500,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Razorpay secret is not configured"})};
    }

    const expected = crypto.createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const valid = crypto.timingSafeEqual(
      Buffer.from(expected,"utf8"),
      Buffer.from(razorpay_signature,"utf8")
    );

    if (!valid) {
      return {statusCode:400,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({success:false,error:"Invalid payment signature"})};
    }

    return {statusCode:200,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({success:true,verified:true,
        razorpay_payment_id,razorpay_order_id})};
  } catch (error) {
    console.error("Payment verification error:",error);
    return {statusCode:500,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({success:false,error:error?.message || "Payment verification failed"})};
  }
};

