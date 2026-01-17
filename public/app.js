// DOM Elements
const onboardingScreen = document.getElementById('onboarding-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const profileForm = document.getElementById('profile-form');
const foodModal = document.getElementById('food-modal');
const summaryModal = document.getElementById('summary-modal');

// State
let profile = null;
let currentAnalysis = null;

// Initialize app
async function init() {
  const response = await fetch('/api/profile');
  const data = await response.json();

  if (data.exists) {
    profile = data.profile;
    showDashboard();
    loadTodayLedger();
  } else {
    showOnboarding();
  }
}

// Screen navigation
function showOnboarding() {
  onboardingScreen.classList.remove('hidden');
  dashboardScreen.classList.add('hidden');
}

function showDashboard() {
  onboardingScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  document.getElementById('calories-burned').textContent = profile.tdee;
  updateStats(0);
}

// Profile form submission
profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = {
    sex: document.getElementById('sex').value,
    age: parseInt(document.getElementById('age').value),
    weight: parseFloat(document.getElementById('weight').value),
    height: parseInt(document.getElementById('height').value),
    activityLevel: document.getElementById('activity').value
  };

  const response = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });

  const data = await response.json();
  if (data.success) {
    profile = data.profile;
    showDashboard();
    loadTodayLedger();
  }
});

// Update dashboard stats
function updateStats(consumed) {
  const burned = profile.tdee;
  const remaining = burned - consumed;
  const percent = Math.round((consumed / burned) * 100);

  document.getElementById('calories-consumed').textContent = consumed;
  document.getElementById('calories-remaining').textContent = remaining;

  const percentDisplay = document.getElementById('progress-percent');
  percentDisplay.textContent = `${percent}%`;

  // Update progress ring
  const circle = document.getElementById('progress-circle');
  const circumference = 326.73;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  // Change color if over goal
  if (percent > 100) {
    circle.classList.add('surplus');
    percentDisplay.style.color = '#ef4444';
  } else {
    circle.classList.remove('surplus');
    percentDisplay.style.color = '';
  }
}

// Load today's ledger
async function loadTodayLedger() {
  const response = await fetch('/api/ledger/today');
  const data = await response.json();
  renderLedger(data.ledger);
  updateStats(data.ledger.totalCalories);
}

// Render ledger entries
function renderLedger(ledger) {
  const container = document.getElementById('ledger-entries');

  if (ledger.entries.length === 0) {
    container.innerHTML = '<p class="empty-state">No food logged yet. Tap "Add Food" to start!</p>';
    return;
  }

  container.innerHTML = ledger.entries.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="ledger-entry">
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(entry.foodName)}</div>
          <div class="entry-time">${time}</div>
        </div>
        <span class="entry-calories">${entry.calories} cal</span>
        <button class="delete-btn" onclick="deleteEntry(${entry.id})">&times;</button>
      </div>
    `;
  }).join('');
}

// Delete entry
async function deleteEntry(id) {
  if (!confirm('Remove this entry?')) return;

  await fetch(`/api/ledger/entry/${id}`, { method: 'DELETE' });
  loadTodayLedger();
}

// Food modal controls
document.getElementById('add-food-btn').addEventListener('click', () => {
  openFoodModal();
});

document.getElementById('close-modal').addEventListener('click', closeFoodModal);

function openFoodModal() {
  foodModal.classList.remove('hidden');
  resetFoodModal();
}

function closeFoodModal() {
  foodModal.classList.add('hidden');
  resetFoodModal();
}

function resetFoodModal() {
  document.getElementById('capture-section').classList.remove('hidden');
  document.getElementById('analysis-section').classList.add('hidden');
  document.getElementById('loading-section').classList.add('hidden');
  document.getElementById('photo-input').value = '';
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('analyze-btn').classList.add('hidden');
  currentAnalysis = null;
}

// Photo handling
document.getElementById('photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const preview = document.getElementById('photo-preview');
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    document.getElementById('analyze-btn').classList.remove('hidden');
    document.querySelector('.capture-area').style.display = 'none';
  }
});

// Analyze food
document.getElementById('analyze-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('photo-input');
  if (!fileInput.files[0]) return;

  // Show loading
  document.getElementById('capture-section').classList.add('hidden');
  document.getElementById('loading-section').classList.remove('hidden');

  const formData = new FormData();
  formData.append('photo', fileInput.files[0]);

  try {
    const response = await fetch('/api/analyze-food', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      currentAnalysis = data.analysis;
      showAnalysisResult(data.analysis);
    } else {
      alert('Failed to analyze food: ' + (data.details || data.error));
      resetFoodModal();
    }
  } catch (error) {
    alert('Error analyzing food: ' + error.message);
    resetFoodModal();
  }
});

// Show analysis result
function showAnalysisResult(analysis) {
  document.getElementById('loading-section').classList.add('hidden');
  document.getElementById('analysis-section').classList.remove('hidden');

  document.getElementById('food-name').textContent = analysis.foodName;
  document.getElementById('calorie-input').value = analysis.estimatedCalories;
  document.getElementById('food-notes').textContent = analysis.notes || '';

  const badge = document.getElementById('confidence-badge');
  badge.textContent = `${analysis.confidence} confidence`;
  badge.className = `confidence-badge ${analysis.confidence}`;
}

// Retake photo
document.getElementById('retake-btn').addEventListener('click', () => {
  resetFoodModal();
  document.querySelector('.capture-area').style.display = '';
});

// Confirm and add to ledger
document.getElementById('confirm-btn').addEventListener('click', async () => {
  const calories = parseInt(document.getElementById('calorie-input').value);
  const foodName = document.getElementById('food-name').textContent;

  if (!calories || calories <= 0) {
    alert('Please enter valid calories');
    return;
  }

  await fetch('/api/ledger/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      foodName,
      calories,
      notes: currentAnalysis?.notes
    })
  });

  closeFoodModal();
  loadTodayLedger();
});

// Summary modal
document.getElementById('view-summary-btn').addEventListener('click', async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  const response = await fetch(`/api/summary/${dateStr}`);
  const data = await response.json();

  if (data.error) {
    alert(data.error);
    return;
  }

  showSummary(data);
});

document.getElementById('close-summary').addEventListener('click', () => {
  summaryModal.classList.add('hidden');
});

function showSummary(data) {
  summaryModal.classList.remove('hidden');

  const dateObj = new Date(data.date + 'T12:00:00');
  document.getElementById('summary-date').textContent = dateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  document.getElementById('summary-consumed').textContent = data.caloriesConsumed;
  document.getElementById('summary-burned').textContent = data.caloriesBurned;

  const balanceEl = document.getElementById('summary-balance');
  const statusEl = document.getElementById('summary-status');
  const resultEl = document.getElementById('summary-result');

  const absBalance = Math.abs(data.balance);
  balanceEl.textContent = (data.balance > 0 ? '+' : '') + data.balance;

  if (data.status === 'surplus') {
    statusEl.textContent = `${absBalance} calorie surplus`;
    resultEl.className = 'summary-result surplus';
  } else if (data.status === 'deficit') {
    statusEl.textContent = `${absBalance} calorie deficit`;
    resultEl.className = 'summary-result deficit';
  } else {
    statusEl.textContent = 'Perfectly balanced';
    resultEl.className = 'summary-result';
  }

  // Show entries
  const entriesContainer = document.getElementById('summary-entries');
  if (data.entries.length > 0) {
    entriesContainer.innerHTML = `
      <h3>Food Log</h3>
      ${data.entries.map(e => `
        <div class="summary-entry">
          <span>${escapeHtml(e.foodName)}</span>
          <span>${e.calories} cal</span>
        </div>
      `).join('')}
    `;
  } else {
    entriesContainer.innerHTML = '<p class="empty-state">No food was logged</p>';
  }
}

// Reset profile
document.getElementById('reset-profile-btn').addEventListener('click', async () => {
  if (!confirm('Reset your profile? This will clear your burn rate settings.')) return;

  await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      weight: 0,
      height: 0,
      age: 0,
      sex: 'male',
      activityLevel: 'sedentary'
    })
  });

  profile = null;
  showOnboarding();
  profileForm.reset();
});

// Utility: escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close modal on backdrop click
foodModal.addEventListener('click', (e) => {
  if (e.target === foodModal) closeFoodModal();
});

summaryModal.addEventListener('click', (e) => {
  if (e.target === summaryModal) summaryModal.classList.add('hidden');
});

// Initialize
init();
