const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data and uploads directories exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Configure multer for photo uploads
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `food_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Initialize Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Helper: Get file paths
const getProfilePath = () => path.join(DATA_DIR, 'profile.json');
const getLedgerPath = (date) => path.join(DATA_DIR, `ledger_${date}.json`);

// Helper: Calculate BMR using Mifflin-St Jeor Equation
function calculateBMR(weight, height, age, sex) {
  // Weight in kg, height in cm, age in years
  if (sex === 'male') {
    return 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    return 10 * weight + 6.25 * height - 5 * age - 161;
  }
}

// Helper: Calculate TDEE (Total Daily Energy Expenditure)
function calculateTDEE(bmr, activityLevel) {
  const multipliers = {
    sedentary: 1.2,      // Little or no exercise
    light: 1.375,        // Light exercise 1-3 days/week
    moderate: 1.55,      // Moderate exercise 3-5 days/week
    active: 1.725,       // Hard exercise 6-7 days/week
    veryActive: 1.9      // Very hard exercise, physical job
  };
  return Math.round(bmr * (multipliers[activityLevel] || 1.2));
}

// Helper: Get today's date string
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// Helper: Load or create ledger for a date
function loadLedger(date) {
  const ledgerPath = getLedgerPath(date);
  if (fs.existsSync(ledgerPath)) {
    return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  }
  return { date, entries: [], totalCalories: 0 };
}

// Helper: Save ledger
function saveLedger(date, ledger) {
  fs.writeFileSync(getLedgerPath(date), JSON.stringify(ledger, null, 2));
}

// API: Save user profile
app.post('/api/profile', (req, res) => {
  const { weight, height, age, sex, activityLevel } = req.body;

  const bmr = calculateBMR(weight, height, age, sex);
  const tdee = calculateTDEE(bmr, activityLevel);

  const profile = {
    weight,
    height,
    age,
    sex,
    activityLevel,
    bmr: Math.round(bmr),
    tdee,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(getProfilePath(), JSON.stringify(profile, null, 2));
  res.json({ success: true, profile });
});

// API: Get user profile
app.get('/api/profile', (req, res) => {
  const profilePath = getProfilePath();
  if (fs.existsSync(profilePath)) {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    res.json({ exists: true, profile });
  } else {
    res.json({ exists: false });
  }
});

// API: Analyze food photo with Claude
app.post('/api/analyze-food', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const imageData = fs.readFileSync(req.file.path);
    const base64Image = imageData.toString('base64');
    const mediaType = req.file.mimetype;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: `Analyze this food image and estimate the calories. Respond in JSON format only:
{
  "foodName": "Brief description of the food",
  "items": ["item1", "item2"],
  "estimatedCalories": number,
  "confidence": "low" | "medium" | "high",
  "notes": "Any relevant notes about portion size assumptions"
}

Be realistic about portion sizes visible in the image. If you cannot identify the food, set estimatedCalories to 0 and explain in notes.`
            }
          ]
        }
      ]
    });

    const analysisText = response.content[0].text;
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = analysisText;
    const jsonMatch = analysisText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const analysis = JSON.parse(jsonStr.trim());

    // Clean up uploaded file after analysis
    fs.unlinkSync(req.file.path);

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Error analyzing food:', error);
    res.status(500).json({ error: 'Failed to analyze food photo', details: error.message });
  }
});

// API: Add food entry to ledger
app.post('/api/ledger/add', (req, res) => {
  const { foodName, calories, notes } = req.body;
  const date = getTodayDate();
  const ledger = loadLedger(date);

  const entry = {
    id: Date.now(),
    foodName,
    calories,
    notes,
    timestamp: new Date().toISOString()
  };

  ledger.entries.push(entry);
  ledger.totalCalories = ledger.entries.reduce((sum, e) => sum + e.calories, 0);

  saveLedger(date, ledger);
  res.json({ success: true, entry, ledger });
});

// API: Get today's ledger
app.get('/api/ledger/today', (req, res) => {
  const date = getTodayDate();
  const ledger = loadLedger(date);
  res.json({ ledger });
});

// API: Get ledger for specific date
app.get('/api/ledger/:date', (req, res) => {
  const ledger = loadLedger(req.params.date);
  res.json({ ledger });
});

// API: Delete ledger entry
app.delete('/api/ledger/entry/:id', (req, res) => {
  const date = getTodayDate();
  const ledger = loadLedger(date);

  ledger.entries = ledger.entries.filter(e => e.id !== parseInt(req.params.id));
  ledger.totalCalories = ledger.entries.reduce((sum, e) => sum + e.calories, 0);

  saveLedger(date, ledger);
  res.json({ success: true, ledger });
});

// API: Get daily summary (for morning review)
app.get('/api/summary/:date', (req, res) => {
  const profilePath = getProfilePath();
  if (!fs.existsSync(profilePath)) {
    return res.status(400).json({ error: 'Profile not set up' });
  }

  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const ledger = loadLedger(req.params.date);

  const caloriesBurned = profile.tdee;
  const caloriesConsumed = ledger.totalCalories;
  const balance = caloriesConsumed - caloriesBurned;

  res.json({
    date: req.params.date,
    caloriesBurned,
    caloriesConsumed,
    balance,
    status: balance > 0 ? 'surplus' : balance < 0 ? 'deficit' : 'balanced',
    entries: ledger.entries
  });
});

// API: Get yesterday's summary (for morning check)
app.get('/api/summary/yesterday', (req, res) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  const profilePath = getProfilePath();
  if (!fs.existsSync(profilePath)) {
    return res.status(400).json({ error: 'Profile not set up' });
  }

  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const ledger = loadLedger(dateStr);

  const caloriesBurned = profile.tdee;
  const caloriesConsumed = ledger.totalCalories;
  const balance = caloriesConsumed - caloriesBurned;

  res.json({
    date: dateStr,
    caloriesBurned,
    caloriesConsumed,
    balance,
    status: balance > 0 ? 'surplus' : balance < 0 ? 'deficit' : 'balanced',
    entries: ledger.entries
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Calorie Tracker running at http://localhost:${PORT}`);
});
