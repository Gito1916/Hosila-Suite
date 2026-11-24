---
title: Multi-Desk Hotel Wi-Fi Setup
description: Connect reception laptops, restaurant tablets, and manager offices to your main Hosila PMS computer over hotel Wi-Fi.
---

Hosila PMS keeps all your hotel records safely on **one main reception computer**, while letting every other desk on your property work together in real time over your hotel Wi-Fi or office network.

## How It Works

1. **Main Reception Computer:** Stores all bookings, room statuses, restaurant orders, and accounts safely on your premises.
2. **Additional Staff Devices:** Front-desk laptops, restaurant/bar tablets, and accounting computers connect over the same hotel Wi-Fi by typing your property address shown in **Settings → Property Network** (for example, `http://192.168.1.45:3000`) into Chrome, Edge, or Safari.
3. **Works Without Internet:** Check-ins, room cleaning updates, restaurant bills, and daily reports update across all connected desks instantly even if your internet service drops.
4. **Optional Guest Emails:** Automated booking confirmations and checkout receipt emails send automatically whenever the main reception computer has internet access, and wait safely in a queue if internet is temporarily down.

## If Another Computer Cannot Open the Address

If a second reception laptop or bar tablet cannot reach your property address:

1. Confirm both devices are connected to the **same hotel Wi-Fi or office router** (not a separate guest-only Wi-Fi network).
2. On the main reception computer, open **Windows Defender Firewall → Allow an app through firewall** and allow **Hosila PMS** on **Private networks**.
3. Refresh the browser on the second device—you should see the Hosila PMS login screen immediately.
