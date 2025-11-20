# 🔒 Android Microphone Fix - Complete Guide

## The Problem
On Android, browsers **require HTTPS** to access the microphone. HTTP connections are blocked for security reasons.

## The Solution: Use ngrok (Free & Easy!)

### Step-by-Step Setup

#### Step 1: Start Backend
```bash
cd d:\caly\backend
npm run build
node dist/index.js
```
✅ You should see: `🚀 SERVER READY ON PORT 3000`

#### Step 2: Create ngrok Tunnel to Frontend
Open a **NEW** terminal and run:
```bash
cd d:\caly\frontend
npx ngrok http 5173
```

ngrok will show something like:
```
Forwarding    https://abc-123-def.ngrok-free.app -> http://localhost:5173
```

#### Step 3: Test on Android Phone
1. Get your phone on the same WiFi network (not required but easier)
2. Open the ngrok URL in your phone's browser
3. **Microphone permission will appear** ✅
4. Grant permission and you're done!

### How It Works
```
Android Phone (HTTPS required)
         ↓
ngrok provides HTTPS tunnel
         ↓
http://192.168.29.53:5173 (HTTP - works locally)
         ↓
Backend on localhost:3000
```

---

## URL Reference

### For Android/Mobile
```
https://your-ngrok-url.ngrok-free.app
```
✅ HTTPS works with microphone

### For Desktop (Same WiFi)
```
http://192.168.29.53:5173
```
✅ Local network, direct access, fast

### Test Diagnostics Page
- Mobile: `https://your-ngrok-url.ngrok-free.app/test.html`
- Desktop: `http://192.168.29.53:5173/test.html`

---

## Common Android Issues

### "Microphone access failed" Error
**Cause:** Trying to use HTTP on Android
**Fix:** Use ngrok URL (HTTPS) instead
```bash
npx ngrok http 5173
# Then visit the https:// URL shown
```

### "Microphone permission denied"
**Cause:** You denied permission when browser asked
**Fix:** 
1. Go to Android Settings
2. Find your browser (Chrome, Firefox, etc.)
3. Permissions → Microphone → Allow for this app
4. Refresh the page

### Slow response time on mobile
**Cause:** Mobile data network latency
**Fix:**
- Use same WiFi as backend computer
- Check internet speed
- Can add query param: `?backend=https://backend-ngrok-url`

### "Connection timeout" on mobile
**Possible Causes:**
1. Backend not running
2. Android firewall blocking connection
3. Backend on different network than phone

**Fix:**
```bash
# Terminal 2: Tunnel backend too
npx ngrok http 3000
```

Then visit frontend with query param:
```
https://frontend-url.ngrok-free.app?backend=https://backend-url.ngrok-free.app
```

---

## Protocol Requirements

| Environment | Protocol | Microphone Support | Works |
|-------------|----------|-------------------|-------|
| Desktop - HTTP | HTTP | ✅ Yes | ✅ |
| Desktop - HTTPS | HTTPS | ✅ Yes | ✅ |
| Mobile - HTTP | HTTP | ❌ No | ❌ |
| Mobile - HTTPS | HTTPS | ✅ Yes | ✅ |
| ngrok - HTTP | HTTP | ✅ Yes | ⚠️ Only shows HTTP |
| ngrok - HTTPS | HTTPS | ✅ Yes | ✅ Always works |

**Conclusion:** For Android, always use ngrok or deploy to HTTPS server!

---

## Testing Checklist

- [ ] Backend running on port 3000
- [ ] Frontend built (npm run build)
- [ ] ngrok tunnel created (`npx ngrok http 5173`)
- [ ] Phone on same WiFi (recommended)
- [ ] Opened ngrok HTTPS URL on phone
- [ ] Microphone permission granted
- [ ] Check browser console (F12) for errors
- [ ] Call starts and microphone works

---

## Troubleshooting Flow

```
1. Start ngrok tunnel for frontend
   ↓
2. Copy ngrok URL to phone browser
   ↓
3. See "Allow microphone?" → Click Allow
   ↓
4. If error: Check browser console (F12)
   ↓
5. If timeout: Backend might not be running
   ↓
6. If still failing: Try query param with backend URL
```

---

## Advanced: Self-Signed HTTPS (For Local Network)

If you want local HTTP to work on Android:
```bash
# Generate certificate
openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365

# Update vite.config.ts to use HTTPS with this cert
# Then run: npm run dev
```
⚠️ Tricky setup - ngrok is easier!

---

## Quick Commands

```bash
# Build everything
cd d:\caly\backend && npm run build && cd d:\caly\frontend && npm run build

# Start backend
cd d:\caly\backend && node dist/index.js

# Create ngrok tunnel (NEW terminal)
cd d:\caly\frontend && npx ngrok http 5173

# Test locally
http://192.168.29.53:5173

# Test diagnostics
http://192.168.29.53:5173/test.html
```

---

## Summary

✅ **Best for Android:** Use ngrok + HTTPS
✅ **Best for Desktop:** Local network (HTTP)
✅ **Fastest:** Same WiFi network
✅ **Public Web:** Deploy to HTTPS server (Vercel, Netlify, etc.)

**You're all set! The fix is automatically applied when you:**
1. Use ngrok (which is HTTPS)
2. Or access via same WiFi (which auto-detects your setup)
