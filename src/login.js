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
            
            <!-- Step 1: Request OTP -->
            <div id="fpStep1" class="fp-step active">
                <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Enter your username or registered phone number to receive a security code.</p>
                <div class="form-group">
                    <input type="text" id="fpIdentifier" placeholder="Username or Phone Number" required>
                </div>
                <button class="fp-btn" id="fpRequestBtn">Send Security Code</button>
            </div>
            
            <!-- Step 2: Verify OTP & Reset -->
            <div id="fpStep2" class="fp-step">
                <p style="color: #666; font-size: 14px; margin-bottom: 20px;">A security code has been sent. Please enter it below along with your new password.</p>
                <div class="form-group">
                    <input type="text" id="fpOtp" placeholder="6-digit Security Code" required maxlength="6">
                </div>
                <div class="form-group">
                    <input type="password" id="fpNewPassword" placeholder="New Password" required>
                </div>
                <div class="form-group">
                    <input type="password" id="fpConfirmPassword" placeholder="Confirm Password" required>
                </div>
                <button class="fp-btn" id="fpResetBtn">Reset Password</button>
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
    let currentUsername = '';
    
    document.querySelectorAll('.forgot-password-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            currentRole = e.target.getAttribute('data-role');
            document.getElementById('fpIdentifier').value = '';
            document.getElementById('fpStep1').classList.add('active');
            document.getElementById('fpStep2').classList.remove('active');
            fpModal.classList.add('show');
        });
    });
    
    fpCloseBtn.addEventListener('click', () => fpModal.classList.remove('show'));
    
    document.getElementById('fpRequestBtn').addEventListener('click', async () => {
        const identifier = document.getElementById('fpIdentifier').value.trim();
        if (!identifier) return showErrorModal('Please enter a username or phone number.');
        
        const btn = document.getElementById('fpRequestBtn');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: currentRole, identifier })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                currentUsername = data.username;
                if (data.smsSent) {
                    alert(`✅ ${data.message}\n\nThe security code has been sent to your registered phone number via SMS.`);
                } else {
                    alert(`SUCCESS: ${data.message}\n\n[MOCK MODE] SMS not configured — Your Security Code is: ${data.mockCode}`);
                }
                document.getElementById('fpStep1').classList.remove('active');
                document.getElementById('fpStep2').classList.add('active');
            } else {
                showErrorModal(data.error || 'Failed to send security code.');
            }
        } catch (err) {
            showErrorModal('Network error.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Send Security Code';
        }
    });
    
    document.getElementById('fpResetBtn').addEventListener('click', async () => {
        const otp = document.getElementById('fpOtp').value.trim();
        const newPassword = document.getElementById('fpNewPassword').value;
        const confirmPassword = document.getElementById('fpConfirmPassword').value;
        
        if (!otp || !newPassword || !confirmPassword) return showErrorModal('Please fill all fields.');
        if (newPassword !== confirmPassword) return showErrorModal('Passwords do not match.');
        
        const btn = document.getElementById('fpResetBtn');
        btn.disabled = true;
        btn.textContent = 'Resetting...';
        
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: currentRole, username: currentUsername, otp, newPassword })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                alert('Password reset successfully! You can now log in.');
                fpModal.classList.remove('show');
            } else {
                showErrorModal(data.error || 'Failed to reset password.');
            }
        } catch (err) {
            showErrorModal('Network error.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Reset Password';
        }
    });
});
