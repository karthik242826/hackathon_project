// Target a specific doctor profile (e.g., Doctor with D_ID = 1 from your table)
const LOGGED_IN_DOCTOR_ID = 1; 

document.addEventListener('DOMContentLoaded', () => {
    // Inject current date context cleanly into header UI
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').innerText = new Date().toLocaleDateString('en-US', dateOptions);
    
    // Execute data fetch lifecycle
    loadDoctorDashboardData();
    setupFormInterceptor();
});

// 1. READ PIPELINE: Pull data out of hms.db through our server endpoints
async function loadDoctorDashboardData() {
    try {
        const response = await fetch(`/api/doctor-dashboard/${LOGGED_IN_DOCTOR_ID}`);
        if (!response.ok) throw new Error('Network response returned error codes');
        
        const data = await response.json();

        // Bind Doctor details to layout profile nodes
        document.getElementById('doctor-name').innerText = `${data.doctor.DOCTOR_FIRSTNAME} ${data.doctor.DOCTOR_LASTNAME}`;
        document.getElementById('doctor-specialization').innerText = data.doctor.DOCTOR_SPECIALIZATION;

        // Compute metrics panel counters dynamically
        document.getElementById('count-appointments').innerText = data.appointments.length;
        const pendingCount = data.appointments.filter(a => a.APPOINTMENT_STATUS === 'SCHEDULED').length;
        document.getElementById('count-pending').innerText = pendingCount;

        // Render rows dynamically into table body viewport
        const tbody = document.getElementById('appointments-tbody');
        tbody.innerHTML = ''; // Clear existing static design rows

        if (data.appointments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#7f8c8d;">No appointments scheduled for today.</td></tr>`;
            return;
        }

        data.appointments.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${row.APPOINTMENT_TIME}</b></td>
                <td>${row.PATIENT_FIRSTNAME} ${row.PATIENT_LASTNAME}</td>
                <td><span class="badge">${row.APPOINTMENT_VISIT_TYPE}</span></td>
                <td><code class="status-${row.APPOINTMENT_STATUS.toLowerCase()}">${row.APPOINTMENT_STATUS}</code></td>
                <td>
                    ${row.APPOINTMENT_STATUS === 'SCHEDULED' ? 
                    `<button class="action-btn" onclick="openPrescriptionModal(${row.AID}, ${row.PATIENT_ID})">Write Prescription</button>` : 
                    `<button class="action-btn btn-disabled" disabled>Completed</button>`}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Critical initialization failure in frontend dashboard pipeline:', error);
    }
}

// Modal Toggle Controls
function openPrescriptionModal(appointmentId, patientId) {
    document.getElementById('form-appointment-id').value = appointmentId;
    document.getElementById('form-patient-id').value = patientId;
    document.getElementById('prescription-modal').classList.remove('hidden');
}

function closePrescriptionModal() {
    document.getElementById('prescription-modal').classList.add('hidden');
    document.getElementById('prescription-form').reset();
}

// 2. WRITE PIPELINE: Intercept submit actions to pass values down to SQL engine
function setupFormInterceptor() {
    document.getElementById('prescription-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            appointment_id: parseInt(document.getElementById('form-appointment-id').value),
            patient_id: parseInt(document.getElementById('form-patient-id').value),
            doctor_id: LOGGED_IN_DOCTOR_ID,
            diagnosis: document.getElementById('form-diagnosis').value,
            symptoms: document.getElementById('form-symptoms').value,
            medicine_name: document.getElementById('form-medicine').value,
            dosage: document.getElementById('form-dosage').value,
            frequency: document.getElementById('form-frequency').value,
            duration: document.getElementById('form-duration').value
        };

        try {
            const response = await fetch('/api/save-prescription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                alert('Prescription successfully committed to hms.db!');
                closePrescriptionModal();
                loadDoctorDashboardData(); // Refresh list layout instantly to reflect update
            } else {
                alert('Database insertion transaction failed.');
            }
        } catch (err) {
            console.error('Network failure writing to execution pipeline:', err);
        }
    });
}