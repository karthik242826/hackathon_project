// Error modal functions
const errorModal = document.getElementById('errorModal');
const errorCloseBtn = document.querySelector('.error-close-btn');
const errorOkBtn = document.querySelector('.error-ok-btn');
const errorMessage = document.getElementById('errorMessage');

function showErrorModal(message) {
    errorMessage.textContent = message;
    errorModal.classList.add('show');
}

function closeErrorModal() {
    errorModal.classList.remove('show');
}

// Close error modal when close button is clicked
errorCloseBtn.addEventListener('click', closeErrorModal);

// Close error modal when OK button is clicked
errorOkBtn.addEventListener('click', closeErrorModal);

// Close error modal when clicking outside
window.addEventListener('click', function(e) {
    if (e.target === errorModal) {
        closeErrorModal();
    }
});

// =====================================
// Forgot Password Logic
// =====================================
function injectForgotPasswordModal() {
    const html = `
    <div id="fpModal" class="fp-modal">
        <div class="fp-modal-content">
            <div class="fp-header">
                <h2 id="fpTitle">Forgot Password</h2>
                <span class="fp-close-btn" id="fpCloseBtn">&times;</span>
            </div>
            
            <div id="fpStep1" class="fp-step active">
                <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Enter your username or email address to request a password reset.</p>
                <div class="form-group">
                    <input type="text" id="fpIdentifier" placeholder="Username or Email Address" required>
                </div>
                <button class="fp-btn" id="fpRequestBtn">Request Password Reset</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

document.addEventListener('DOMContentLoaded', () => {
    injectForgotPasswordModal();
    
    const fpModal = document.getElementById('fpModal');
    const fpCloseBtn = document.getElementById('fpCloseBtn');
    let currentRole = '';
    
    document.querySelectorAll('.forgot-password-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            currentRole = e.target.getAttribute('data-role');
            document.getElementById('fpIdentifier').value = '';
            fpModal.classList.add('show');
        });
    });
    
    fpCloseBtn.addEventListener('click', () => fpModal.classList.remove('show'));
    
    document.getElementById('fpRequestBtn').addEventListener('click', async () => {
        const identifier = document.getElementById('fpIdentifier').value.trim();
        if (!identifier) return showErrorModal('Please enter a username or email.');
        
        const btn = document.getElementById('fpRequestBtn');
        btn.disabled = true;
        btn.textContent = 'Sending Request...';
        
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: currentRole, identifier })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                alert(`SUCCESS: ${data.message}`);
                fpModal.classList.remove('show');
            } else {
                showErrorModal(data.error || 'Failed to request password reset.');
            }
        } catch (err) {
            showErrorModal('Network error.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Request Password Reset';
        }
    });
});
