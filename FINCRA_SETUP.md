# Fincra Payment Gateway Setup Guide

## Overview
Fincra has been integrated using the official Checkout Redirect API per https://docs.fincra.com/docs/checkout-redirect

## Supported Currencies
Per https://docs.fincra.com/docs/checkout-redirect:
- **NGN** - Nigerian Naira (bank_transfer, card, payattitude)
- **GHS** - Ghanaian Cedi (mobile_money, bank_transfer)
- **KES** - Kenyan Shilling (mobile_money)
- **UGX** - Ugandan Shilling (mobile_money)
- **ZMW** - Zambian Kwacha (mobile_money, card)
- **ZAR** - South African Rand (bank_transfer, card)
- **USD** - US Dollar (card)
- **TZS** - Tanzanian Shilling (mobile_money)
- **XAF** - CFA Franc BEAC (mobile_money)
- **XOF** - CFA Franc BCEAO (mobile_money)

## Payment Method Selection Logic
Per official documentation, the system selects payment gateways based on currency:
- **Paystack**: NGN only
- **AlatPay**: NGN, USD (https://docs.alatpay.ng/web-plugin)
- **Fincra**: NGN, GHS, KES, UGX, ZMW, ZAR, USD, TZS, XAF, XOF (https://docs.fincra.com/docs/checkout-redirect)

Note: The gateway selection logic is implemented in `frontend/src/helpers/currency.js`.

## Setup Instructions

### 1. Get Your Fincra API Keys

#### For Testing (Sandbox):
1. Create a Fincra account at https://app.fincra.com/auth/signup
2. Log in to your dashboard
3. Toggle to **Test Mode** using the environment switch at the top right
4. Navigate to **Settings** → **Profile** → **API keys and webhook Configuration**
5. Copy the following keys:
   - **Secret Key** (starts with `sk_test_`)
   - **Public Key** (starts with `pk_test_`)
   - **Webhook Encryption Key**

#### For Production (Live):
1. Complete business verification in your Fincra dashboard
2. Toggle to **Live Mode** using the environment switch
3. Navigate to **Settings** → **Profile** → **API keys and webhook Configuration**
4. Copy the following keys:
   - **Secret Key** (starts with `sk_live_`)
   - **Public Key** (starts with `pk_live_`)
   - **Webhook Encryption Key**

### 2. Configure Environment Variables

Add these variables to your backend `.env` file:

```bash
# Fincra Configuration
FINCRA_SECRET_KEY=sk_test_your_secret_key_here
FINCRA_PUBLIC_KEY=pk_test_your_public_key_here
FINCRA_WEBHOOK_SECRET=your_webhook_encryption_key_here

# Optional: Explicitly set live mode (auto-detected from NODE_ENV in production)
# FINCRA_LIVE_MODE=true
```

**Alternative Environment Variable Names Supported:**
- `FINCRA_SECRET` (alias for FINCRA_SECRET_KEY)
- `FINCRA_PUBLIC_KEY` (standard)
- `FINCRA_WEBHOOK_KEY` (alias for FINCRA_WEBHOOK_SECRET)

**Environment Detection:**
The system automatically detects whether to use Live or Sandbox API based on:
1. `FINCRA_LIVE_MODE=true` environment variable (explicit override)
2. `NODE_ENV=production` (automatic in production environments like Render)
3. Key patterns (keys without 'test' or 'sandbox' are treated as live)

**Important**: 
- Use `sk_test_` and `pk_test_` keys for development/testing
- Use `sk_live_` and `pk_live_` keys for production
- If your live keys don't follow the `sk_live_`/`pk_live_` pattern, ensure `NODE_ENV=production` is set
- Never commit these keys to version control

### 3. Configure Webhook URL

Webhooks are essential for confirming payments even if the user closes the browser.

1. Log in to your Fincra dashboard
2. Go to **Settings** → **Portal Settings** → **Webhook Configuration**
3. Set your webhook URL to:
   ```
   https://your-backend-domain.com/api/webhook/fincra
   ```
   
   For local testing with tools like ngrok:
   ```
   https://your-ngrok-url.ngrok.io/api/webhook/fincra
   ```

4. Save the configuration

### 4. Test the Integration

#### Test with Sandbox Cards:
Use these test cards in Test Mode:

**Successful Payment (NGN) - Mastercard:**
- Card Number: `5319 3178 0136 6660`
- Expiry: `10/26`
- CVV: `000`

**Successful Payment with PIN:**
- Card Number: `5366 1398 3386 4633`
- Expiry: `06/26`
- CVV: `123`
- PIN: `1234`

**Failed Payment (Insufficient Funds):**
- Card Number: `4084 0800 0000 5408`
- Expiry: `06/26`
- CVV: `000`
- PIN: `1234`

Full test card list: https://docs.fincra.com/docs/test-cards

#### Testing Flow:
1. Create an event with tickets priced in a Fincra-supported currency (e.g., KES, ZAR)
2. Add tickets to cart
3. Proceed to checkout
4. You should see "Pay with Fincra" option
5. Complete payment using test cards
6. Webhook should process the order and send confirmation emails

### 5. Go Live Checklist

Before switching to production:

- [ ] Complete business verification in Fincra dashboard
- [ ] Update `.env` with live API keys (`sk_live_` and `pk_live_`)
- [ ] Configure production webhook URL in Fincra dashboard
- [ ] Test with small real transaction
- [ ] Verify webhook signature validation is working
- [ ] Confirm email notifications are being sent
- [ ] Verify order creation in database

## How It Works

### Payment Flow:
1. User selects tickets priced in a Fincra-supported currency
2. System automatically selects Fincra as payment gateway
3. User clicks "Pay Now"
4. Backend creates Fincra checkout session
5. User is redirected to Fincra's hosted checkout page
6. User completes payment (card, bank transfer, or mobile money)
7. Fincra processes payment and sends webhook to backend
8. Backend validates webhook signature
9. Backend creates order, generates PDF ticket, and sends emails
10. User is redirected back to success page

### Webhook Security:
All webhooks are validated using HMAC SHA-512 signature verification to ensure they're genuine Fincra webhooks and haven't been tampered with.

## API Endpoints

### Initialize Payment:
```
POST /api/fincra/create-checkout
```

Request body:
```json
{
  "email": "customer@example.com",
  "amount": 1000,
  "currency": "KES",
  "metadata": {
    "orderData": { ... }
  }
}
```

### Webhook Handler:
```
POST /api/webhook/fincra
```

Headers:
- `signature`: HMAC SHA-512 signature of request body

## Troubleshooting

### Webhook not receiving events:
1. Verify webhook URL is correct in Fincra dashboard
2. Check webhook URL is publicly accessible (use ngrok for local testing)
3. Check backend logs for webhook signature validation errors
4. Verify `FINCRA_WEBHOOK_SECRET` matches the key in Fincra dashboard

### Payment fails:
1. Check API keys are correct
2. Verify currency is supported
3. Check backend logs for detailed error messages
4. Ensure using test cards in Test Mode

### Orders not created:
1. Check webhook is configured and receiving events
2. Verify webhook signature validation is passing
3. Check order metadata is being passed correctly
4. Review backend logs for order processing errors

## Support & Documentation

- **Getting Started**: https://docs.fincra.com/docs/getting-started
- **API Environments**: https://docs.fincra.com/docs/api-environments
- **Authentication**: https://docs.fincra.com/docs/authentication
- **Checkout Redirect**: https://docs.fincra.com/docs/checkout-redirect
- **Checkout Standard**: https://docs.fincra.com/docs/checkout-standard
- **Webhook Setup**: https://docs.fincra.com/docs/setup-webhook
- **Webhook Validation**: https://docs.fincra.com/docs/validating-webhook
- **Payin Webhooks**: https://docs.fincra.com/docs/payin-webhook
- **Test Cards**: https://docs.fincra.com/docs/test-cards

## Security Best Practices

1. **Never expose secret keys** in frontend code or version control
2. **Always validate webhook signatures** before processing (HMAC-SHA512, hex encoded)
3. **Use HTTPS** for all webhook URLs in production
4. **Implement idempotency** checks to prevent duplicate orders
5. **Monitor failed webhooks** and implement retry logic
6. **Log all payment events** for audit trail
7. **Keep API keys secure** using environment variables
