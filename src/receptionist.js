if (sessionStorage.getItem('hms_receptionist_auth') !== 'true') {
    window.location.href = './receptionist-login.html';
}

document.addEventListener('DOMContentLoaded', () => {
    let allAppointments = [];

    // Render current date cleanly in header
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').innerText = new Date().toLocaleDateString('en-US', dateOptions);

    // Fetch and bind dashboard datasets
    loadDashboardData();

    async function loadDashboardData() {
        try {
            // Load patients list
            const patientsResponse = await fetch('/api/patients');
            const patients = patientsResponse.ok ? await patientsResponse.json() : [];
            document.getElementById('total-patients').innerText = patients.length;
            renderPatientsDirectory(patients);

            // Load doctors for filter
            const doctorsResponse = await fetch('/api/doctors');
            const doctors = doctorsResponse.ok ? await doctorsResponse.json() : [];
            const doctorSelect = document.getElementById('filter-doctor');
            if (doctorSelect) {
                doctorSelect.innerHTML = '<option value="">All Doctors</option>';
                doctors.forEach(d => {
                    doctorSelect.innerHTML += `<option value="${d.D_ID}">Dr. ${d.DOCTOR_FIRSTNAME} ${d.DOCTOR_LASTNAME}</option>`;
                });
            }

            // Load appointments list
            const apptsResponse = await fetch('/api/appointments');
            allAppointments = apptsResponse.ok ? await apptsResponse.json() : [];
            
            // Set default date filter to today's local date
            const filterDateInput = document.getElementById('filter-date');
            if (filterDateInput) {
                const tzOffset = (new Date()).getTimezoneOffset() * 60000;
                const localISODate = (new Date(Date.now() - tzOffset)).toISOString().split('T')[0];
                filterDateInput.value = localISODate;
            }

            // Bind filters change events
            if (filterDateInput) filterDateInput.addEventListener('change', applyFilters);
            if (doctorSelect) doctorSelect.addEventListener('change', applyFilters);

            // Apply initial filtering
            applyFilters();

            // Load invoices list (to compute metrics and revenue sum)
            const billsResponse = await fetch('/api/bills');
            const bills = billsResponse.ok ? await billsResponse.json() : [];
            
            const totalRevenue = bills.reduce((sum, bill) => sum + (bill.TOTAL_AMOUNT || 0), 0);
            document.getElementById('total-revenue').innerText = `₹${totalRevenue.toFixed(2)}`;

        } catch (error) {
            console.error('Error fetching receptionist metrics:', error);
        }
    }

    function applyFilters() {
        const filterDateInput = document.getElementById('filter-date');
        const doctorSelect = document.getElementById('filter-doctor');
        
        const selectedDate = filterDateInput ? filterDateInput.value : '';
        const selectedDoctorId = doctorSelect ? doctorSelect.value : '';

        const filtered = allAppointments.filter(a => {
            const matchesDate = !selectedDate || a.APPOINTMENT_DATE === selectedDate;
            const matchesDoctor = !selectedDoctorId || a.DOCTOR_ID.toString() === selectedDoctorId.toString();
            return matchesDate && matchesDoctor;
        });

        // Update Active Bookings metric count with filtered SCHEDULED appointments
        const activeCount = filtered.filter(a => a.APPOINTMENT_STATUS === 'SCHEDULED').length;
        document.getElementById('total-appointments').innerText = activeCount;

        renderAppointmentsSchedule(filtered);
    }

    function renderPatientsDirectory(patients) {
        const tbody = document.getElementById('patients-tbody');
        tbody.innerHTML = '';

        if (patients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No patients registered.</td></tr>';
            return;
        }

        patients.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>PID-${p.PID}</code></td>
                <td><b>${p.PATIENT_FIRSTNAME} ${p.PATIENT_LASTNAME}</b></td>
                <td>${p.PATIENT_GENDER}</td>
                <td><span class="badge bg-secondary">${p.PATIENT_BLOODGROUP}</span></td>
                <td>${p.PATIENT_PHNO}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderAppointmentsSchedule(appointments) {
        const tbody = document.getElementById('appointments-tbody');
        tbody.innerHTML = '';

        if (appointments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No appointments scheduled.</td></tr>';
            return;
        }

        appointments.forEach(a => {
            const tr = document.createElement('tr');
            let statusBadge = '';
            
            if (a.APPOINTMENT_STATUS === 'SCHEDULED') {
                statusBadge = '<span class="badge-scheduled">Scheduled</span>';
            } else if (a.APPOINTMENT_STATUS === 'COMPLETED') {
                statusBadge = `<span class="badge-completed" style="cursor: pointer;" onclick="viewPrescription(${a.AID})">Completed <i class="bi bi-eye"></i></span>`;
            } else {
                statusBadge = '<span class="badge-cancelled">Cancelled</span>';
            }

            tr.innerHTML = `
                <td><b>${a.PATIENT_FIRSTNAME} ${a.PATIENT_LASTNAME}</b></td>
                <td>Dr. ${a.DOCTOR_FIRSTNAME} ${a.DOCTOR_LASTNAME}</td>
                <td>${a.APPOINTMENT_DATE} / <code class="text-dark">${a.APPOINTMENT_TIME}</code></td>
                <td><span class="badge bg-light text-dark border">${a.APPOINTMENT_VISIT_TYPE}</span></td>
                <td>${statusBadge}</td>
            `;
            tbody.appendChild(tr);
        });
    }
});

// View prescription modal logic
window.viewPrescription = async function(apptId) {
    const modalElement = document.getElementById('prescriptionViewModal');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    const bodyElement = document.getElementById('prescription-modal-body');
    bodyElement.innerHTML = `
        <div class="text-center py-3">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    `;

    try {
        const response = await fetch(`/api/prescription-by-appointment/${apptId}`);
        if (!response.ok) throw new Error('Failed to load prescription');
        const p = await response.json();

        if (p) {
            let medicinesListHTML = '';
            try {
                const parsedMeds = JSON.parse(p.MEDICINE_NAME);
                if (Array.isArray(parsedMeds)) {
                    parsedMeds.forEach(m => {
                        medicinesListHTML += `
                            <div class="mb-2 pb-2 border-bottom">
                                <strong class="text-primary" style="color: #4f46e5 !important;">${m.name}</strong>
                                <div class="row text-center small mt-1 text-dark">
                                    <div class="col-4 border-end">Dosage: <b>${m.dosage}</b></div>
                                    <div class="col-4 border-end">Frequency: <b>${m.frequency}</b></div>
                                    <div class="col-4">Duration: <b>${m.duration}</b></div>
                                </div>
                            </div>
                        `;
                    });
                } else throw new Error();
            } catch(e) {
                // Fallback for legacy
                medicinesListHTML = `
                    <div class="mb-2 pb-2 border-bottom">
                        <strong class="text-primary" style="color: #4f46e5 !important;">${p.MEDICINE_NAME}</strong>
                        <div class="row text-center small mt-1 text-dark">
                            <div class="col-4 border-end">Dosage: <b>${p.MEDICINE_DOSAGE}</b></div>
                            <div class="col-4 border-end">Frequency: <b>${p.MEDICINE_FREQUENCY}</b></div>
                            <div class="col-4">Duration: <b>${p.MEDICINE_DURATION}</b></div>
                        </div>
                    </div>
                `;
            }

            bodyElement.innerHTML = `
                <div class="mb-3 border-bottom pb-2">
                    <span class="text-muted small d-block">Treating Physician</span>
                    <strong class="text-dark fs-5">Dr. ${p.DOCTOR_FIRSTNAME} ${p.DOCTOR_LASTNAME} (${p.DOCTOR_SPECIALIZATION})</strong>
                </div>
                <div class="mb-3 border-bottom pb-2">
                    <span class="text-muted small d-block">Observed Symptoms / Diagnosis</span>
                    <p class="m-0 fw-bold" style="color: #4f46e5;">${p.SYMPTOMS}</p>
                </div>
                <div class="mb-3">
                    <span class="text-muted small d-block mb-2">Prescribed Medication</span>
                    <div class="bg-light p-3 rounded-3">${medicinesListHTML}</div>
                </div>
            `;
        } else {
            bodyElement.innerHTML = `<p class="text-muted text-center m-0">No prescription details have been recorded for this appointment yet.</p>`;
        }
    } catch (error) {
        console.error('Error fetching prescription details:', error);
        bodyElement.innerHTML = `<p class="text-danger text-center m-0">Error retrieving prescription record from database.</p>`;
    }
};

// Secure Sign Out with session cookie clearance
window.signOut = async function() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    sessionStorage.removeItem('hms_receptionist_auth');
    sessionStorage.removeItem('hms_receptionist_name');
    sessionStorage.removeItem('hms_receptionist_username');
    window.location.href = './index.html';
};

// Change Password Modal Controls
window.openChangePasswordModal = function() {
    document.getElementById('change-password-modal').classList.remove('hidden');
};

window.closeChangePasswordModal = function() {
    document.getElementById('change-password-modal').classList.add('hidden');
    document.getElementById('change-password-form').reset();
    document.getElementById('password-error-msg').classList.add('hidden');
};

// Setup receptionist change password submit handler
document.addEventListener('DOMContentLoaded', () => {
    const changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPassword = document.getElementById('old-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmNewPassword = document.getElementById('confirm-new-password').value;
            const errorMsg = document.getElementById('password-error-msg');

            if (newPassword !== confirmNewPassword) {
                errorMsg.innerText = "Passwords do not match!";
                errorMsg.classList.remove('hidden');
                return;
            }

            errorMsg.classList.add('hidden');

            const recepUsername = sessionStorage.getItem('hms_receptionist_username') || 'receptionist';

            try {
                const response = await fetch('/api/receptionist/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recepUsername, oldPassword, newPassword })
                });

                const data = await response.json();
                if (response.ok && data.success) {
                    alert('Password updated successfully!');
                    closeChangePasswordModal();
                } else {
                    alert(data.error || 'Failed to update password.');
                }
            } catch (err) {
                console.error('Error changing password:', err);
                alert('Network error. Failed to update password.');
            }
        });
    }
});
