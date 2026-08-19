exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return {statusCode:405,body:JSON.stringify({error:"Method not allowed"})};
    const {RAZORPAY_KEY_ID,RAZORPAY_KEY_SECRET}=process.env;
    if(!RAZORPAY_KEY_ID||!RAZORPAY_KEY_SECRET)
      return {statusCode:500,body:JSON.stringify({error:"Razorpay environment variables are missing."})};

    const {amount}=JSON.parse(event.body||"{}");
    const rupees=Number(amount);
    if(!Number.isFinite(rupees)||rupees<=0)
      return {statusCode:400,body:JSON.stringify({error:"Invalid payment amount."})};

    const auth=Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    const r=await fetch("https://api.razorpay.com/v1/orders",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Basic ${auth}`},
      body:JSON.stringify({
        amount:Math.round(rupees*100),
        currency:"INR",
        receipt:"POSTERLY_"+Date.now(),
        notes:{store:"POSTERLY"}
      })
    });
    const d=await r.json();
    if(!r.ok) return {statusCode:r.status,body:JSON.stringify({error:d?.error?.description||"Razorpay order creation failed."})};

    return {statusCode:200,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({success:true,key_id:RAZORPAY_KEY_ID,order_id:d.id,amount:d.amount,currency:d.currency})};
  } catch(e) {
    console.error(e);
    return {statusCode:500,body:JSON.stringify({error:"Internal server error."})};
  }
};
