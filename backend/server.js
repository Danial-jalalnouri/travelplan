require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Firebase Admin (verifies users from the frontend) =====
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
        const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        // Vercel: env var is JSON string; local: env var is file path
        if (creds.startsWith('{')) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(creds))
            });
        } else {
            admin.initializeApp({
                credential: admin.credential.cert(creds)
            });
        }
        console.log('Firebase Admin initialized');
    } catch (error) {
        console.error('Firebase Admin init failed:', error.message);
    }
} else {
    console.warn('WARNING: GOOGLE_APPLICATION_CREDENTIALS not set. Auth verification disabled!');
}

// ===== Server-side configuration (NOT exposed to frontend) =====
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const DEFAULT_MAX_PLANS = parseInt(process.env.DEFAULT_MAX_PLANS, 10) || 2;

// Middleware
app.use(cors());
app.use(express.json());

// OpenRouter API configuration
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;
// Ordered list of models to try. Falls back to the next one when a model is
// rate-limited (429) or fails. Override via AI_MODELS (comma-separated).
const DEFAULT_MODELS = [
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'cohere/north-mini-code:free',
    'openai/gpt-oss-20b:free'
];
const MODELS = (process.env.AI_MODELS || DEFAULT_MODELS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const MODEL = MODELS[0];

// Small helper to wait (used for rate-limit retries)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===== Auth Middleware: only allow logged-in users of THIS app =====
async function requireAuth(req, res, next) {
    const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null;

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        // Verify the Firebase ID token. If it's valid, the user is logged in
        // through this app's Firebase project and has access.
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', model: MODEL });
});

// Check if user is admin (PROTECTED - requires auth)
app.get('/api/admin/check', requireAuth, async (req, res) => {
    try {
        const userEmail = req.user.email?.toLowerCase();
        const isAdmin = ADMIN_EMAILS.includes(userEmail);
        res.json({ isAdmin });
    } catch (error) {
        console.error('Error checking admin status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== Admin Middleware: only allow admin users =====
async function requireAdmin(req, res, next) {
    const userEmail = req.user.email?.toLowerCase();
    if (!ADMIN_EMAILS.includes(userEmail)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// Get all users (ADMIN ONLY)
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const usersSnapshot = await admin.firestore().collection('users').get();
        const users = [];
        usersSnapshot.forEach((doc) => {
            users.push({ id: doc.id, ...doc.data() });
        });
        res.json({ users });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all plans (ADMIN ONLY)
app.get('/api/admin/plans', requireAuth, requireAdmin, async (req, res) => {
    try {
        const plansSnapshot = await admin.firestore().collection('travel_plans').get();
        const plans = [];
        plansSnapshot.forEach((doc) => {
            plans.push({ id: doc.id, ...doc.data() });
        });
        res.json({ plans });
    } catch (error) {
        console.error('Error getting plans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user max plans (ADMIN ONLY)
app.put('/api/admin/users/:userId/max-plans', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { maxPlans } = req.body;
        
        if (typeof maxPlans !== 'number' || maxPlans < 1) {
            return res.status(400).json({ error: 'maxPlans must be a number >= 1' });
        }
        
        await admin.firestore().collection('users').doc(userId).update({ maxPlans });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating max plans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user settings (default max plans)
app.get('/api/config/user-settings', requireAuth, async (req, res) => {
    try {
        res.json({ defaultMaxPlans: DEFAULT_MAX_PLANS });
    } catch (error) {
        console.error('Error getting user settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== User endpoints (all Firestore operations server-side) =====

// Setup user - create if not exists
app.post('/api/users/setup', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const email = req.user.email;
        const displayName = req.user.name || email;

        const usersRef = admin.firestore().collection('users');
        const q = usersRef.where('userId', '==', userId);
        const snapshot = await q.get();

        if (snapshot.empty) {
            const docRef = await usersRef.add({
                userId,
                email,
                displayName,
                maxPlans: DEFAULT_MAX_PLANS,
                createdAt: new Date().toISOString()
            });
            res.json({ id: docRef.id, userId, email, displayName, maxPlans: DEFAULT_MAX_PLANS });
        } else {
            const doc = snapshot.docs[0];
            res.json({ id: doc.id, ...doc.data() });
        }
    } catch (error) {
        console.error('Error setting up user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user's data
app.get('/api/users/me', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const usersRef = admin.firestore().collection('users');
        const q = usersRef.where('userId', '==', userId);
        const snapshot = await q.get();

        if (snapshot.empty) {
            return res.status(404).json({ error: 'User not found' });
        }

        const doc = snapshot.docs[0];
        res.json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error('Error getting user data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== Plan endpoints =====

// Save a plan
app.post('/api/plans', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { city, startDate, endDate, plan } = req.body;

        if (!city || !startDate || !endDate || !plan) {
            return res.status(400).json({ error: 'city, startDate, endDate, and plan are required' });
        }

        const plansRef = admin.firestore().collection('travel_plans');
        const docRef = await plansRef.add({
            userId,
            city,
            startDate,
            endDate,
            plan: typeof plan === 'string' ? plan : JSON.stringify(plan),
            createdAt: new Date().toISOString()
        });

        res.json({ id: docRef.id });
    } catch (error) {
        console.error('Error saving plan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user's plans
app.get('/api/plans', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const plansRef = admin.firestore().collection('travel_plans');
        const q = plansRef.where('userId', '==', userId);
        const snapshot = await q.get();

        const plans = [];
        snapshot.forEach((doc) => {
            plans.push({ id: doc.id, ...doc.data() });
        });

        // Sort by createdAt descending
        plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ plans });
    } catch (error) {
        console.error('Error getting plans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a specific plan (must belong to current user)
app.get('/api/plans/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { id } = req.params;

        const doc = await admin.firestore().collection('travel_plans').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        const data = doc.data();
        if (data.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ id: doc.id, ...data });
    } catch (error) {
        console.error('Error getting plan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a plan (must belong to current user)
app.delete('/api/plans/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { id } = req.params;

        const doc = await admin.firestore().collection('travel_plans').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        const data = doc.data();
        if (data.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await admin.firestore().collection('travel_plans').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting plan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user's plan count
app.get('/api/plans/count', requireAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const plansRef = admin.firestore().collection('travel_plans');
        const q = plansRef.where('userId', '==', userId);
        const snapshot = await q.get();

        res.json({ count: snapshot.size });
    } catch (error) {
        console.error('Error getting plan count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Builds the AI prompt from user inputs. Kept server-side so users
// cannot see or modify the prompt.
function buildPrompt({ city, days, startDate, endDate }) {
    return `Create a detailed ${days}-day travel plan for ${city} from ${startDate} to ${endDate}.

IMPORTANT: Return ONLY valid JSON with no extra text. Keep descriptions short (1-2 sentences max).

JSON structure:
{
  "destination": "${city}",
  "totalDays": ${days},
  "overview": "Brief 1-2 sentence overview",
  "generalTips": ["tip1", "tip2", "tip3"],
  "budgetEstimate": "Estimated total budget",
  "days": [
    {
      "dayNumber": 1,
      "date": "${startDate}",
      "theme": "Theme for the day",
      "morning": {
        "time": "9:00 AM - 12:00 PM",
        "activities": ["activity1", "activity2"],
        "location": "Location name",
        "description": "Brief description"
      },
      "afternoon": {
        "time": "12:00 PM - 5:00 PM",
        "activities": ["activity1", "activity2"],
        "location": "Location name",
        "description": "Brief description"
      },
      "evening": {
        "time": "5:00 PM - 10:00 PM",
        "activities": ["activity1", "activity2"],
        "location": "Location name",
        "description": "Brief description"
      },
      "meals": {
        "breakfast": {"name": "Restaurant", "cuisine": "Type", "price": "$$", "description": "Brief"},
        "lunch": {"name": "Restaurant", "cuisine": "Type", "price": "$$", "description": "Brief"},
        "dinner": {"name": "Restaurant", "cuisine": "Type", "price": "$$", "description": "Brief"}
      },
      "transportTips": ["tip1", "tip2"],
      "dailyBudget": "$100-150",
      "highlights": ["highlight1", "highlight2"]
    }
  ]
}

Requirements:
- Return ONLY the JSON object, no markdown, no extra text
- Keep all descriptions under 15 words
- Include 3-5 general tips
- Include real restaurant and attraction names
- Return ONLY valid JSON`;
}

// Chat endpoint for generating travel plans (PROTECTED)
app.post('/api/generate-plan', requireAuth, async (req, res) => {
    const reqId = Date.now().toString(36);
    console.log(`[${reqId}] generate-plan start`, { city: req.body.city, days: req.body.days });
    try {
        const { city, days, startDate, endDate } = req.body;

        if (!city || !days || !startDate || !endDate) {
            return res.status(400).json({ error: 'city, days, startDate, and endDate are required' });
        }

        // ===== Input validation =====
        const cityStr = String(city).trim();
        const daysNum = parseInt(days, 10);

        if (cityStr.length < 2 || cityStr.length > 100) {
            return res.status(400).json({ error: 'City must be 2-100 characters' });
        }
        if (!/^[a-zA-Z\s,.\-()]+$/.test(cityStr)) {
            return res.status(400).json({ error: 'City contains invalid characters' });
        }
        if (isNaN(daysNum) || daysNum < 1 || daysNum > 30) {
            return res.status(400).json({ error: 'Days must be a number between 1 and 30' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) {
            return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
        }

        // Sanitize city for prompt (strip anything that isn't letters, spaces, punctuation)
        const sanitizedCity = cityStr.replace(/[^a-zA-Z\s,.\-()]/g, '');

        if (!API_KEY) {
            return res.status(500).json({ error: 'API key not configured' });
        }

        // ===== Plan limit check (server-side) =====
        const userId = req.user.uid;
        const usersRef = admin.firestore().collection('users');
        const userQuery = usersRef.where('userId', '==', userId);
        const userSnapshot = await userQuery.get();

        let maxPlans = DEFAULT_MAX_PLANS;
        if (!userSnapshot.empty) {
            const userData = userSnapshot.docs[0].data();
            maxPlans = userData.maxPlans || DEFAULT_MAX_PLANS;
        }

        const plansRef = admin.firestore().collection('travel_plans');
        const plansQuery = plansRef.where('userId', '==', userId);
        const plansSnapshot = await plansQuery.get();

        if (plansSnapshot.size >= maxPlans) {
            return res.status(403).json({ error: `Plan limit reached (${maxPlans} plans). Delete some plans or contact admin.` });
        }

        const prompt = buildPrompt({ city: sanitizedCity, days: daysNum, startDate, endDate });

        const systemMessage = 'You are a travel planning assistant. You MUST respond with ONLY a single valid JSON object. Absolutely no prose, no explanations, no markdown, no "here is your plan" text. Do not describe what you will do - just output the JSON object directly.';

        async function callOpenRouter(messages, extra = {}) {
            // Try each model. For each model: one quick attempt; if rate-limited
            // (429) wait retry_after_seconds, then retry the same model once.
            // Then move on. This makes progress visible in the log.
            const hardDeadline = Date.now() + 90_000; // total cap of ~90s

            for (let m = 0; m < MODELS.length; m++) {
                const model = MODELS[m];

                for (let retry = 0; retry < 2; retry++) {
                    if (Date.now() > hardDeadline) {
                        throw new Error('OpenRouter request timed out (90s cap)');
                    }

                    console.log(`[${model}] attempt ${retry + 1}/2...`);
                    // 80s timeout covering fetch + body read + json parse
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 80_000);
                    try {
                        const response = await fetch(OPENROUTER_API_URL, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${API_KEY}`,
                                'Content-Type': 'application/json',
                                'HTTP-Referer': 'http://localhost:3000',
                                'X-Title': 'TravelPlan'
                            },
                            body: JSON.stringify({
                                model,
                                messages,
                                temperature: 0.4,
                                max_tokens: 16000,
                                response_format: { type: 'json_object' },
                                ...extra
                            }),
                            signal: controller.signal
                        });

                        if (response.ok) {
                            console.log(`[${model}] got 200, reading body...`);
                            const text = await response.text();
                            clearTimeout(timeoutId);
                            console.log(`[${model}] body received, len=${text.length}`);
                            const data = JSON.parse(text);
                            const message = data.choices?.[0]?.message;
                            console.log(`[${model}] parsed, content_len=${(message?.content || '').length}, reasoning_len=${(message?.reasoning || '').length}`);
                            return {
                                content: message?.content || '',
                                reasoning: message?.reasoning || ''
                            };
                        }

                        clearTimeout(timeoutId);
                        const errorText = await response.text();
                        console.error(`[${model}] HTTP ${response.status}: ${errorText.substring(0, 300)}`);

                        // Only wait+retry on 429
                        if (response.status === 429 && retry === 0) {
                            let waitMs = 8000; // default
                            try {
                                const errJson = JSON.parse(errorText);
                                const ra = errJson?.error?.metadata?.retry_after_seconds;
                                if (ra) waitMs = Math.min(ra * 1000, 30000);
                            } catch (e) { /* ignore */ }
                            console.log(`[${model}] rate-limited, waiting ${Math.round(waitMs / 1000)}s before retry...`);
                            await sleep(waitMs);
                            continue; // retry same model
                        }
                        break; // non-429 or already retried once -> next model
                    } catch (error) {
                        clearTimeout(timeoutId);
                        if (error.name === 'AbortError') {
                            console.error(`[${model}] request timed out after 80s`);
                        } else {
                            console.error(`[${model}] failed: ${error.message}`);
                        }
                        break; // network error -> next model
                    }
                }
            }

            throw new Error('All models exhausted or rate-limited');
        }

        // Extract JSON, preferring clean `content`. Reasoning text may contain
        // stray `{`/`}` that breaks naive substring extraction, so only fall
        // back to the concatenation when content alone has no JSON.
        function extractBestJson(result) {
            const contentJson = extractJson(result.content);
            if (contentJson) return contentJson;
            return extractJson(result.content + result.reasoning);
        }

        // Attempt 1: normal call
        console.log(`[${reqId}] calling OpenRouter...`);
        let result = await callOpenRouter([
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt }
        ]);
        console.log(`[${reqId}] first call done`);

        // If no JSON found, the model emitted only reasoning -> retry with a follow-up nudge
        if (!extractBestJson(result)) {
            console.log(`[${reqId}] No JSON in first response, retrying with correction prompt...`);
            result = await callOpenRouter([
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt },
                {
                    role: 'assistant',
                    content: result.content || result.reasoning
                },
                {
                    role: 'user',
                    content: 'Your previous response did not contain a valid JSON object. Output ONLY the JSON object now, with no thinking, no prose, and no markdown.'
                }
            ]);
            console.log(`[${reqId}] retry done`);
        }

        console.log(`[${reqId}] extracting JSON...`);
        const jsonText = extractBestJson(result);
        console.log(`[${reqId}] extracted=${!!jsonText}, len=${jsonText ? jsonText.length : 0}`);
        if (!jsonText) {
            const rawText = result.content + result.reasoning;
            console.error(`[${reqId}] Could not extract JSON. Raw response (first 1000 chars):`, rawText.substring(0, 1000));
            return res.status(500).json({ error: 'Model did not return valid JSON' });
        }

        console.log(`[${reqId}] sending response...`);
        res.json({ content: jsonText });
        console.log(`[${reqId}] response sent`);

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Extract a JSON object (or array) from a text blob
function extractJson(text) {
    if (!text) return null;

    // If the whole thing is JSON, return it as-is
    try {
        const parsed = JSON.parse(text.trim());
        return text.trim();
    } catch (e) { /* not plain JSON */ }

    // Strip markdown code fences
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        try {
            JSON.parse(fenced[1].trim());
            return fenced[1].trim();
        } catch (e) { /* keep looking */ }
    }

    // Find the first { ... } block and try to parse it
    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex !== -1 && endIndex > startIndex) {
        const candidate = text.substring(startIndex, endIndex + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch (e) { /* try to fix trailing commas */ }
        const fixed = candidate
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/:\s*,/g, ': null,');
        try {
            JSON.parse(fixed);
            return fixed;
        } catch (e) { /* not JSON */ }
    }

    return null;
}

// ===== Serve the frontend =====
// The backend also serves the static frontend files (index.html, css/, js/)
app.use(express.static(path.join(__dirname, '..')));

// Start server (local development)
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`TravelPlan running on http://localhost:${PORT}`);
        console.log(`Using model: ${MODEL}`);
    });
}

// Export for Vercel serverless
module.exports = app;
