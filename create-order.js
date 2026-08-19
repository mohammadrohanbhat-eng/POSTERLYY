
const crypto = require("crypto");

const PRODUCTS = {
  "batman.jpeg": 15,
  "berlin.jpeg": 15,
  "comic-hero.jpeg": 15,
  "doctor-doom.jpeg": 15,
  "lets-cook.jpeg": 15,
  "messi-10-dark.jpeg": 15,
  "messi-10-vintage.jpeg": 15,
  "porsche.jpeg": 15,
  "professor.jpeg": 15,
  "spiderman.jpeg": 15,
  "thomas-shelby.jpeg": 15,
  "tom-jerry.jpeg": 15
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return json(500, { error: "Razorpay server keys are not configured in Netlify." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const customer = body.customer || {};
    const cart = Array.isArray(body.cart) ? body.cart : [];

    if (!customer.name || !customer.phone || !customer.address) {
      return json(400, { error: "Customer name, phone and address are required." });
    }
    if (!cart.length) return json(400, { error: "Cart is empty." });

    let total = 0;
    const safeItems = [];

    for (const item of cart) {
      if (item.type === "pack") {
        const qty = Math.max(1, Math.min(99, Number(item.qty) || 0));
        total += 80 * qty;
        safeItems.push({ type: "pack", name: "Mix-Up Series — 10 displayed posters", qty, unitPrice: 80 });
      } else if (item.type === "poster") {
        const file = String(item.file || "");
        const qty = Math.max(1, Math.min(100, Number(item.qty) || 0));
        if (!PRODUCTS[file]) return json(400, { error: "Invalid poster in cart." });
        total += PRODUCTS[file] * qty;
        safeItems.push({ type: "poster", file, qty, unitPrice: 15 });
      } else {
        return json(400, { error: "Invalid cart item." });
      }
    }

    if (!Number.isFinite(total) || total < 1) return json(400, { error: "Invalid order total." });

    const receipt = `PL_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: total * 100,
        currency: "INR",
        receipt,
        notes: {
          customer_name: String(customer.name).slice(0, 200),
          customer_phone: String(customer.phone).slice(0, 50)
        }
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Razorpay order error", data);
      return json(502, { error: "Could not create Razorpay order." });
    }

    // The browser receives only the public Key ID and the server-created order.
    return json(200, {
      keyId,
      razorpayOrderId: data.id,
      amount: total * 100,
      currency: "INR",
      receipt,
      items: safeItems
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error while creating order." });
  }
};
