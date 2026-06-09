const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const cors = require('cors');

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

const OWNER_EMAIL = 'FollowFlowSupport@proton.me';

app.use(cors());
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/followers-landing.html');
});

// Stripe wymaga raw body dla webhooków
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// =============================================
// 1. Tworzenie płatności
// =============================================
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, platform, package: pkg, qty, username, method } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount, // w groszach
      currency: 'pln',
      payment_method_types: ['card', 'blik', 'p24'],
      metadata: { platform, package: pkg, qty: String(qty), username, method }
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// 2. Stripe Checkout Session
// =============================================
app.post('/create-checkout', async (req, res) => {
  try {
    const { amount, platform, package: pkg, qty, username, method } = req.body;
    const platformNames = { ig: 'Instagram', tt: 'TikTok' };
    const packageNames = { basic: 'Basic', premium: 'Premium', real: 'Real' };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'blik', 'p24'],
      line_items: [{
        price_data: {
          currency: 'pln',
          product_data: {
            name: 'FollowFlow – ' + (platformNames[platform] || platform) + ' ' + (packageNames[pkg] || pkg),
            description: parseInt(qty).toLocaleString('pl-PL') + ' obserwujących dla @' + username,
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://followflow-production.up.railway.app/sukces?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://followflow-production.up.railway.app/',
      metadata: { platform, package: pkg, qty: String(qty), username, method }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// 3. Strona sukcesu
// =============================================
app.get('/sukces', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Dziękujemy!</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#fdf2f8,#ede9fe);}
.box{text-align:center;background:#fff;padding:48px 40px;border-radius:24px;box-shadow:0 20px 60px rgba(124,58,237,0.15);max-width:420px;}
h1{color:#7c3aed;font-size:2rem;margin-bottom:8px;}
p{color:#6b7280;margin-bottom:24px;}
a{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:bold;}
</style></head>
<body><div class="box">
<div style="font-size:4rem;margin-bottom:16px">🎉</div>
<h1>Dziękujemy!</h1>
<p>Twoja płatność została przyjęta.<br>Obserwujący dotrą do <strong>1 dnia roboczego</strong>.</p>
<a href="/">Wróć do strony</a>
</div></body></html>`);
});

// =============================================
// 4. Webhook – po udanej płatności wysyła maila
// =============================================
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { platform, package: pkg, qty, username, method } = session.metadata;
    const kwota = (session.amount_total / 100).toFixed(2).replace('.', ',') + ' zł';

    const packageNames = { basic: 'Basic', premium: 'Premium', real: 'Real' };
    const platformNames = { ig: 'Instagram', tt: 'TikTok' };

    const emailResult = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'followflowsupport@proton.me',
      subject: `Nowe zamowienie FollowFlow - ${kwota}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f9f9f9;padding:32px;border-radius:16px">
          <h2 style="color:#7c3aed;margin-bottom:24px">🚀 Nowe zamówienie FollowFlow</h2>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden">
            <tr style="background:#f3f0ff">
              <td style="padding:12px 16px;font-weight:bold;color:#555;width:40%">Platforma</td>
              <td style="padding:12px 16px;font-weight:bold;color:#111">${platformNames[platform] || platform}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;color:#555;border-top:1px solid #f0f0f0">Nick / Profil</td>
              <td style="padding:12px 16px;font-weight:bold;color:#111;border-top:1px solid #f0f0f0">@${username}</td>
            </tr>
            <tr style="background:#fafafa">
              <td style="padding:12px 16px;color:#555;border-top:1px solid #f0f0f0">Pakiet</td>
              <td style="padding:12px 16px;border-top:1px solid #f0f0f0">${packageNames[pkg] || pkg}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;color:#555;border-top:1px solid #f0f0f0">Ilość</td>
              <td style="padding:12px 16px;font-weight:bold;color:#111;border-top:1px solid #f0f0f0">${parseInt(qty).toLocaleString('pl-PL')} obserwujących</td>
            </tr>
            <tr style="background:#fafafa">
              <td style="padding:12px 16px;color:#555;border-top:1px solid #f0f0f0">Metoda płatności</td>
              <td style="padding:12px 16px;border-top:1px solid #f0f0f0">${method}</td>
            </tr>
            <tr style="background:#f3f0ff">
              <td style="padding:14px 16px;font-weight:bold;color:#7c3aed;border-top:2px solid #ddd6fe;font-size:1.1em">💰 Kwota</td>
              <td style="padding:14px 16px;font-weight:bold;color:#7c3aed;border-top:2px solid #ddd6fe;font-size:1.1em">${kwota}</td>
            </tr>
          </table>
          <p style="color:#888;font-size:12px;margin-top:20px;text-align:center">
            FollowFlow · Realizacja do 1 dnia roboczego · Payment ID: ${session.id}
          </p>
        </div>
      `
    });

    console.log('Email result:', JSON.stringify(emailResult));
    if (emailResult.error) {
      console.error('Resend error:', JSON.stringify(emailResult.error));
    } else {
      console.log('Email sent OK, id:', emailResult.data && emailResult.data.id);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FollowFlow server running on port ${PORT}`));
