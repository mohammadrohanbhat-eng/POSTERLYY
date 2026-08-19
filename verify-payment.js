const crypto=require("crypto");
exports.handler=async(event)=>{
  try{
    if(event.httpMethod!=="POST") return {statusCode:405,body:JSON.stringify({error:"Method not allowed"})};
    const secret=process.env.RAZORPAY_KEY_SECRET;
    if(!secret) return {statusCode:500,body:JSON.stringify({error:"RAZORPAY_KEY_SECRET is missing."})};
    const {razorpay_payment_id,razorpay_order_id,razorpay_signature}=JSON.parse(event.body||"{}");
    if(!razorpay_payment_id||!razorpay_order_id||!razorpay_signature)
      return {statusCode:400,body:JSON.stringify({success:false,error:"Missing Razorpay payment information."})};

    const expected=crypto.createHmac("sha256",secret)
      .update(razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
    const valid=expected.length===razorpay_signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(razorpay_signature));

    if(!valid) return {statusCode:400,body:JSON.stringify({success:false,error:"Invalid payment signature."})};
    return {statusCode:200,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({success:true,payment_id:razorpay_payment_id,order_id:razorpay_order_id})};
  }catch(e){
    console.error(e);
    return {statusCode:500,body:JSON.stringify({success:false,error:"Payment verification failed."})};
  }
};
