document.addEventListener('DOMContentLoaded', () => {
    const bookingForm = document.getElementById('bookingForm');
    const patientSelect = document.getElementById('patient-select');
    const doctorSelect = document.getElementById('doctor-select');

    // Load patients and doctors on init
    loadFormData();

    async function loadFormData() {
        try {
            // Load patients
            const patientsResponse = await fetch('/api/patients');
            if (patientsResponse.ok) {
                const patients = await patientsResponse.json();
                patientSelect.innerHTML = '<option value="" disabled selected>Select patient...</option>';
                patients.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.PID;
                    opt.textContent = `${p.PATIENT_FIRSTNAME} ${p.PATIENT_LASTNAME} (ID: ${p.PID}) - Ph: ${p.PATIENT_PHNO}`;
                    patientSelect.appendChild(opt);
                });
            } else {
                patientSelect.innerHTML = '<option value="" disabled>Error loading patients</option>';
            }

            // Load doctors
            const doctorsResponse = await fetch('/api/doctors');
            if (doctorsResponse.ok) {
                const doctors = await doctorsResponse.json();
                doctorSelect.innerHTML = '<option value="" disabled selected>Select doctor...</option>';
                doctors.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.D_ID;
                    opt.textContent = `Dr. ${d.DOCTOR_FIRSTNAME} ${d.DOCTOR_LASTNAME} (${d.DOCTOR_SPECIALIZATION})`;
                    doctorSelect.appendChild(opt);
                });
            } else {
                doctorSelect.innerHTML = '<option value="" disabled>Error loading doctors</option>';
            }
        } catch (error) {
            console.error('Error loading form lists:', error);
            alert('Could not contact server to populate doctor/patient dropdowns.');
        }
    }

    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            patient_id: parseInt(patientSelect.value),
            doctor_id: parseInt(doctorSelect.value),
            appointment_date: document.getElementById('appointment-date').value,
            appointment_time: document.getElementById('appointment-time').value,
            appointment_visit_type: document.getElementById('visit-type').value
        };

        try {
            const response = await fetch('/api/add-appointment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                alert(`Appointment successfully booked! Appointment ID: ${result.id}`);
                bookingForm.reset();
                window.location.href = './receptionist.html';
            } else {
                alert(result.error || 'Failed to book appointment.');
            }
        } catch (error) {
            console.error('Error in appointment scheduling:', error);
            alert('A network error occurred while booking. Please try again.');
        }
    });
});
