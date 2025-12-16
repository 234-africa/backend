# AlatPay Payment Gateway Setup Guide

## Overview
AlatPay has been integrated using the official Web Plugin per https://docs.alatpay.ng/web-plugin

## Supported Currencies
Per official documentation (https://docs.alatpay.ng/web-plugin):
- **NGN** - Nigerian Naira (all payment methods)
- **USD** - US Dollar (card payments only)

## Payment Channels
Per https://docs.alatpay.ng/get-started:
| Value | Payment Channel |
|-------|-----------------|
| * | All |
| 1 | Card |
| 2 | Bank Transfer |
| 3 | Bank Details |
| 5 | Phone (USSD) |
| 8 | Static account |

## Setup Instructions

### 1. Get Your AlatPay API Keys
Per https://docs.alatpay.ng/get-api-keys:

1. Log in to your ALATPay dashboard
2. Click on **Settings** in the side menu
3. Click on **Business** and then **View**
4. Enter your ALATPay Pin to view keys

You need:
- **Public Key** (apiKey) - Used for frontend Web Plugin integration
- **Secret Key** - Used for backend API calls (stored as Ocp-Apim-Subscription-Key header)
- **Business ID** - Your unique business identifier

### 2. Configure Environment Variables

Add these to your backend `.env` file:
```bash
ALATPAY_API_KEY=your_public_key_here
ALATPAY_BUSINESS_ID=your_business_id_here
ALATPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

### 3. Configure Webhook URL
Per https://docs.alatpay.ng/setup-webhook-url:

1. Log in to your account
2. Go to **Settings**
3. Select **Business**
4. Click **Edit** next to your business
5. Add your webhook URL: `https://your-backend-domain.com/api/webhook/alatpay`
6. Click **Update Details**

### 4. Webhook Validation
Per https://docs.alatpay.ng/webhook-validation:

- AlatPay uses **HMAC-SHA256** with **Base64** encoding
- Signature is in the `x-signature` header
- IP to whitelist: `74.178.162.156`

## How It Works

### Web Plugin Flow (Frontend)
Per https://docs.alatpay.ng/web-plugin:

1. Load script: `https://web.alatpay.ng/js/alatpay.js`
2. Call `Alatpay.setup({...})` with configuration
3. Call `popup.show()` to display payment modal
4. Handle `onTransaction` callback for payment result
5. Handle `onClose` callback when user closes modal

### Configuration Parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| apiKey | Yes | Your public key from ALATPay |
| businessId | Yes | Your business ID |
| email | Yes | Customer's email address |
| firstName | Yes | Customer's first name |
| lastName | Yes | Customer's last name |
| currency | Yes | NGN or USD |
| amount | Yes | Transaction amount |
| phone | No | Customer's phone number |
| metadata | No | Additional transaction details |
| onTransaction | No | Callback for transaction result |
| onClose | No | Callback when modal closes |

## API Endpoints

### Bank Transfer API
Per https://docs.alatpay.ng/bank-transfer:

Base URL: `https://apibox.alatpay.ng`

Headers:
```
Content-Type: application/json
Ocp-Apim-Subscription-Key: YOUR_SECRET_KEY
```

Generate Virtual Account:
```
POST /bank-transfer/api/v1/bankTransfer/virtualAccount
```

Check Transaction Status:
```
GET /bank-transfer/api/v1/bankTransfer/transactions/{transactionId}
```

## Webhook Payload Structure
Per https://docs.alatpay.ng/setup-webhook-url:

```json
{
  "Value": {
    "Data": {
      "Amount": 100.00,
      "OrderId": "",
      "Customer": {
        "Email": "johndoe@gmail.com",
        "Phone": "081****01",
        "FirstName": "john",
        "LastName": "doe",
        "Metadata": "your metadata"
      },
      "Currency": "NGN",
      "Status": "completed",
      "BusinessName": "your-business-name"
    },
    "Status": true,
    "Message": "Success"
  },
  "StatusCode": 200
}
```

## Response Codes
Per https://docs.alatpay.ng/response:

| Code | Status | Description |
|------|--------|-------------|
| 200 | Success | Request successful |
| 201 | Created | Resource created |
| 400 | Bad Request | Invalid request |
| 401 | Unauthorized | Invalid API key |
| 417 | Expectation Failed | Unable to generate Virtual Account |
| 422 | Unprocessed Entity | Missing required field |
| 5XX | Server Error | AlatPay internal error |

## Support & Documentation

- Official Docs: https://docs.alatpay.ng
- Support Email: alatpaysupport@wemabank.com
- Slack Community: https://bit.ly/ALATPay-Community
