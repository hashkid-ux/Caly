# Socket.io Connection Debugging Guide

## Android Users - IMPORTANT! 📱

**Android requires HTTPS for microphone access!** This is a browser security requirement.

### Android Setup Options:

#### Option 1: Use ngrok (Easiest) ✅
1. Start backend: `node d:\caly\backend\dist\index.js`
2. Start ngrok frontend tunnel:
   ```
   cd d:\caly\frontend
   npx ngrok http 5173
   ```
3. ngrok will show: `https://abc-xyz.ngrok-free.app`
4. Open that URL on Android phone → microphone will work!

#### Option 2: Use ngrok for BOTH frontend and backend
1. Terminal 1: `npx ngrok http 5173` (frontend)
2. Terminal 2: `cd backend && npx ngrok http 3000` (backend)
3. Visit frontend ngrok URL on Android
4. Add query param with backend URL:
   ```
   https://frontend-url.ngrok-free.app?backend=https://backend-url.ngrok-free.app
   ```

#### Option 3: Self-signed HTTPS certificate (Advanced)
```
# Generate certificate
openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365

# Update Vite config to use HTTPS
# Edit vite.config.ts and configure https: {...}
```

**Why HTTP doesn't work on Android:**
- Modern browsers block microphone access on insecure (HTTP) connections
- HTTPS is required for getUserMedia API on Android
- ngrok provides HTTPS for free (that's why it works!)

---

## Quick Start

1. **Build and Start Backend:**
   ```
   cd d:\caly\backend
   npm run build
   node dist/index.js
   ```
   Should show: `✅ Server running on port 3000`

2. **Build Frontend:**
   ```
   cd d:\caly\frontend
   npm run build
   ```

3. **Test Local Connection (Same Network - Desktop):**
   - Open: `http://192.168.29.53:5173`
   - Open browser DevTools (F12)
   - Check Console tab for connection logs
   - Should see: `✅ CONNECTED to server`

4. **Test with ngrok (Mobile + Desktop):**
   ```
   cd d:\caly\frontend
   npx ngrok http 5173
   ```
   Then visit: `https://your-ngrok-url.ngrok-free.app`

5. **If Connection Fails from ngrok, Use Query Parameter:**
   ```
   https://your-ngrok-url.ngrok-free.app?backend=http://192.168.29.53:3000
   ```

## Diagnostics Page

Visit: `http://192.168.29.53:5173/test.html` (Desktop only - needs HTTP)
OR: `https://your-ngrok-url.ngrok-free.app/test.html` (Works on mobile)

This will:
- Detect your environment (ngrok, local, Android, etc.)
- Show Socket.io connection attempts
- Display transport type (websocket vs polling)
- Show any connection errors with details

## Common Issues & Solutions

### Issue: Android - "Microphone access failed"
**Cause:** HTTP connection (insecure)
**Solution:** Use HTTPS via ngrok or self-signed cert
```bash
# Easy solution - use ngrok
npx ngrok http 5173
```

### Issue: Connection timeout from ngrok frontend
**Cause:** ngrok frontend can't reach local network IP (192.168.29.53)
**Solution 1:** Use query parameter with backend URL:
```
?backend=http://192.168.29.53:3000
```

**Solution 2:** Tunnel backend via ngrok too:
```
ngrok http 3000
```
Then update frontend query param to ngrok backend URL

**Solution 3:** Test on same network first:
```
http://192.168.29.53:5173
```

### Issue: Websocket connection fails, polling is slow
**What's Happening:** Socket.io tries websocket (fast), times out after 10s, then falls back to polling
**Fix:** Query parameter ensures backend URL is correct before trying

### Issue: "WebRTC connection error"
**Check:**
1. Backend running? `node d:\caly\backend\dist\index.js`
2. Backend reachable? Can you access `http://192.168.29.53:3000/health` in browser?
3. Frontend connected to correct backend URL?

## Network Architecture

```
Frontend (5173)  ←Socket.io→  Backend (3000)
    ↓                             ↓
ngrok tunnel            Local network IP
  HTTPS                 192.168.29.53
   OR                    (HTTP locally)
Same network IP
```

If frontend on ngrok but backend on local network:
- Direct connection won't work (ngrok can't reach 192.168.x.x)
- Solution: Pass backend URL via query param

## Status Checks

Backend health endpoint:
```
http://192.168.29.53:3000/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "...",
  "targetLatency": 300,
  "activeSessions": 0
}
```

## Deployment Guide

### For Production (Public Internet)
1. Use ngrok for local testing
2. Deploy backend to cloud (AWS, Heroku, Railway, etc.)
3. Deploy frontend to Vercel, Netlify, etc. (auto-HTTPS)
4. Update backend URL in frontend config

### For Local Network Only (LAN Party)
1. Both desktop and mobile on same WiFi
2. Desktop: Start backend locally
3. Desktop: `npx http-server d:\caly\frontend\dist -p 5173`
4. Mobile: Connect to `http://192.168.29.53:5173`
5. ⚠️ Microphone won't work on mobile (needs HTTPS) - only desktop audio works

## Next Steps

1. **Are you on Android or Desktop?**
   - Android → Use ngrok (Option 1 above)
   - Desktop → Use local network IP directly

2. **Getting timeout or connection refused?**
   - Timeout → backend unreachable from frontend
   - Refused → backend not running

3. **Can you access the diagnostics page?**
   - Yes → Use that to see real-time connection attempts
   - No → Check if frontend dev server is running

4. **What's your exact error message?**
   - Share browser console error for faster debugging
