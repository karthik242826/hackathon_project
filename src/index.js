// Get the login modal and button
const loginBtn = document.getElementById('loginBtn');
const loginModal = document.getElementById('loginModal');
const closeBtn = document.querySelector('.close-btn');

loginBtn.addEventListener('click', function(e) {
    e.preventDefault();
    loginModal.classList.add('show');
});

closeBtn.addEventListener('click', function() {
    loginModal.classList.remove('show');
});

window.addEventListener('click', function(e) {
    if (e.target === loginModal) {
        loginModal.classList.remove('show');
    }
});

const doctorBtn = document.querySelector('.doctor-btn');
const patientBtn = document.querySelector('.patient-btn');
const receptionistBtn = document.querySelector('.receptionist-btn');

doctorBtn.addEventListener('click', function() {
    window.location.href = './doctor-login.html';
});

patientBtn.addEventListener('click', function() {
    window.location.href = './patient-login.html';
});

receptionistBtn.addEventListener('click', function() {
    window.location.href = './receptionist-login.html';
});
