# TravelPlan

AI-powered travel planning web application with a Node.js backend and secure AI integration.

**Version:** 5.4.0

## Features

- **AI-Powered Plans**: Personalized day-by-day itineraries via OpenRouter AI
- **Secure API**: AI endpoint protected by Firebase Authentication (only logged-in users)
- **JSON Structured Data**: Plans returned as structured JSON
- **Interactive Day Panels**: Day-by-day navigation with tabs
- **Dedicated Sections**: Morning, Afternoon, Evening, Meals, Transport Tips, Budget
- **Google Authentication**: Sign in with Google
- **Cloud Storage**: Plans stored in Firebase Firestore (per user)
- **Admin Panel**: Manage user plan limits
- **Auto-Save**: Plans automatically saved after generation
- **Dark Mode**: Toggle between dark and light themes with persistent preference

## Project Structure

```
travelplan/
├── index.html              # Main HTML file (served by backend)
├── admin.html              # Admin panel page
├── README.md               # Project documentation
├── css/
│   └── styles.css          # Styling
├── js/
│   ├── app.js              # Frontend application logic
│   └── admin.js            # Admin panel logic
└── backend/
    ├── server.js           # Node.js backend (Express + OpenRouter + Firebase Admin)
    ├── package.json        # Backend dependencies
    ├── .env                # Environment variables (API keys - NOT committed)
    └── .gitignore          # Ignores node_modules, .env, service account
```

## Technologies Used

- **HTML5/CSS3/JavaScript** - Frontend
- **Node.js + Express** - Backend server (also serves frontend)
- **OpenRouter API** - AI model access
- **Firebase Authentication** - Google sign-in + API protection
- **Firebase Admin SDK** - Server-side token verification
- **Firebase Firestore** - Cloud storage for plans

## Setup Instructions

### 1. Get your OpenRouter API Key
1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create an account and generate an API key

### 2. Get your Firebase Service Account
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Project Settings → Service accounts
3. Click "Generate new private key"
4. Save the JSON file as `backend/firebase-service-account.json`

### 3. Configure environment variables
Edit `backend/.env`:
```
OPENROUTER_API_KEY=your_openrouter_api_key
AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
PORT=3000
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
```

### 4. Install and run (single server)
```bash
cd backend
npm install
npm start
```

Open `http://localhost:3000` in your browser.

The backend serves the frontend AND handles AI requests — no need to run two servers.

## Usage

1. Open `http://localhost:3000`
2. Click **Sign in with Google**
3. Enter your destination city + dates
4. Click "Generate Travel Plan"
5. Browse the day-by-day panel
6. Plans are auto-saved to "Your Saved Plans"
7. Click the 🌙/☀️ button in the navbar to toggle dark mode
8. Admin users can click the **Admin** button in the navbar to access the admin panel

## How It Works

1. **Frontend**: User signs in with Google (Firebase Auth)
2. **Token**: Frontend sends the Firebase ID token with each API request
3. **Backend**: Firebase Admin verifies the token — only valid logged-in users get access
4. **AI**: Backend calls OpenRouter with your API key (kept secret server-side)
5. **Storage**: Plans saved to Firestore per user

## Security

- OpenRouter API key lives only in `backend/.env` (never exposed to browser)
- `/api/generate-plan` requires a valid Firebase ID token
- Admin emails and user settings are stored server-side (not exposed to frontend)
- `/api/admin/check` and `/api/config/user-settings` require authentication
- `.env` and `firebase-service-account.json` are in `.gitignore`

## License

Free to use for personal and educational purposes.