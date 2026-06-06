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
