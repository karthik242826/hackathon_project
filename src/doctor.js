if (sessionStorage.getItem('hms_doctor_auth') !== 'true') {
    window.location.href = './doctor-login.html';
}

const LOGGED_IN_DOCTOR_ID = parseInt(sessionStorage.getItem('hms_doctor_id')) || 1; 

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
                <td><span class="badge bg-light text-dark border">${row.APPOINTMENT_VISIT_TYPE}</span></td>
                <td><code class="status-${row.APPOINTMENT_STATUS.toLowerCase()}">${row.APPOINTMENT_STATUS}</code></td>
                <td>
                    <button class="btn btn-sm btn-outline-info" style="font-size: 0.85rem;" onclick="viewPatientHistory(${row.PATIENT_ID})">
                        📁 View File
                    </button>
                </td>
                <td>
                    ${row.APPOINTMENT_STATUS === 'SCHEDULED' ? 
                    `<button class="btn btn-sm btn-primary py-1" onclick="openPrescriptionModal(${row.AID}, ${row.PATIENT_ID})">Write Prescription</button>` : 
                    `<button class="btn btn-sm btn-secondary py-1" disabled style="opacity: 0.65;">Completed</button>`}
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

// View patient medical history dashboard
window.viewPatientHistory = async function(patientId) {
    const modalElement = document.getElementById('patientHistoryModal');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    // Reset fields to loading state
    document.getElementById('hist-fullname').innerText = 'Loading...';
    document.getElementById('hist-patient-meta').innerText = 'Gathering patient profile records...';
    document.getElementById('hist-phone').innerText = '-';
    document.getElementById('hist-address').innerText = '-';
    
    document.getElementById('hist-visits-tbody').innerHTML = `<tr><td colspan="4" class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`;
    document.getElementById('hist-prescriptions-container').innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-success"></div></div>`;
    document.getElementById('hist-bills-tbody').innerHTML = `<tr><td colspan="6" class="text-center"><div class="spinner-border spinner-border-sm text-warning"></div></td></tr>`;

    try {
        const response = await fetch(`/api/patient-dashboard/${patientId}`);
        if (!response.ok) throw new Error('Failed to retrieve patient medical file');
        const data = await response.json();
        window.currentPatientHistoryData = data;

        // 1. Populate Profile Header
        document.getElementById('hist-fullname').innerText = `${data.patient.PATIENT_FIRSTNAME} ${data.patient.PATIENT_LASTNAME}`;
        document.getElementById('hist-patient-meta').innerText = `ID: PID-${data.patient.PID} | DOB: ${data.patient.PATIENT_DOB} | Blood Group: ${data.patient.PATIENT_BLOODGROUP}`;
        document.getElementById('hist-phone').innerText = data.patient.PATIENT_PHNO;
        document.getElementById('hist-address').innerText = data.patient.PATIENT_ADDRESS;

        // 2. Populate Visit Logs Table
        const visitTbody = document.getElementById('hist-visits-tbody');
        visitTbody.innerHTML = '';
        if (data.appointments.length === 0) {
            visitTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No appointments logged.</td></tr>';
        } else {
            data.appointments.forEach(a => {
                const tr = document.createElement('tr');
                const statusClass = a.APPOINTMENT_STATUS === 'COMPLETED' ? 'text-success' : 'text-primary';
                tr.innerHTML = `
                    <td><b>${a.APPOINTMENT_DATE}</b> / <code>${a.APPOINTMENT_TIME}</code></td>
                    <td>Dr. ${a.DOCTOR_FIRSTNAME} ${a.DOCTOR_LASTNAME}</td>
                    <td><span class="badge bg-light text-dark border">${a.APPOINTMENT_VISIT_TYPE}</span></td>
                    <td><strong class="${statusClass}">${a.APPOINTMENT_STATUS}</strong></td>
                `;
                visitTbody.appendChild(tr);
            });
        }

        // 3. Populate Prescriptions Cards List
        const prescContainer = document.getElementById('hist-prescriptions-container');
        prescContainer.innerHTML = '';
        if (data.prescriptions.length === 0) {
            prescContainer.innerHTML = '<p class="text-muted text-center py-3">No prescriptions recorded for this patient.</p>';
        } else {
            data.prescriptions.forEach(p => {
                const card = document.createElement('div');
                card.style.border = '1px solid #e2e8f0';
                card.style.borderRadius = '8px';
                card.style.padding = '12px';
                card.style.marginBottom = '10px';
                card.style.backgroundColor = '#f8fafc';
                card.innerHTML = `
                    <div class="d-flex justify-content-between align-items-start border-bottom pb-1 mb-2">
                        <div>
                            <strong class="text-primary" style="color: #4f46e5 !important;">${p.MEDICINE_NAME}</strong>
                            <span class="small text-muted d-block">Prescribed by Dr. ${p.DOCTOR_FIRSTNAME} ${p.DOCTOR_LASTNAME}</span>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span class="badge bg-secondary small">Date: ${p.APPOINTMENT_DATE}</span>
                            <button class="btn btn-sm btn-outline-success" style="font-size: 0.75rem;" onclick="downloadPrescriptionPDF(${p.PRESCRIPTION_ID})">
                                <i class="bi bi-file-earmark-pdf-fill"></i> PDF
                            </button>
                            <button class="btn btn-sm btn-outline-secondary" style="font-size: 0.75rem;" onclick="printPrescriptionAlternative(${p.PRESCRIPTION_ID})">
                                <i class="bi bi-printer-fill"></i> Print
                            </button>
                        </div>
                    </div>
                    <div class="row text-center small mb-2 text-dark">
                        <div class="col-4 border-end">Dosage: <b>${p.MEDICINE_DOSAGE}</b></div>
                        <div class="col-4 border-end">Frequency: <b>${p.MEDICINE_FREQUENCY}</b></div>
                        <div class="col-4">Duration: <b>${p.MEDICINE_DURATION}</b></div>
                    </div>
                    <div class="small">
                        <span class="text-muted d-block" style="font-size: 11px;">Symptoms / Diagnosis:</span>
                        <strong class="text-dark">${p.SYMPTOMS}</strong>
                    </div>
                `;
                prescContainer.appendChild(card);
            });
        }

        // 4. Populate Bills Transactions Table
        const billsTbody = document.getElementById('hist-bills-tbody');
        billsTbody.innerHTML = '';
        if (data.bills.length === 0) {
            billsTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No financial invoices found.</td></tr>';
        } else {
            data.bills.forEach(b => {
                const tr = document.createElement('tr');
                const formattedDate = new Date(b.BILL_DATE).toLocaleDateString();
                const badge = b.PAYMENT_STATUS === 'PAID' 
                    ? '<span class="badge bg-success">Paid</span>' 
                    : '<span class="badge bg-warning text-dark">Pending</span>';
                
                tr.innerHTML = `
                    <td><code>INV-${b.BILL_ID}</code></td>
                    <td>${formattedDate}</td>
                    <td class="small">Consult: ₹${b.CONSULTATION_CHARGES} | Lab: ₹${b.LAB_CHARGES} | Meds: ₹${b.MEDICINE_CHARGES}</td>
                    <td><b>₹${b.TOTAL_AMOUNT.toFixed(2)}</b></td>
                    <td>${badge}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" style="font-size: 0.75rem;" onclick="downloadInvoicePDF(${b.BILL_ID})">
                            <i class="bi bi-file-earmark-pdf-fill"></i> PDF
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" style="font-size: 0.75rem;" onclick="printInvoiceAlternative(${b.BILL_ID})">
                            <i class="bi bi-printer-fill"></i> Print
                        </button>
                    </td>
                `;
                billsTbody.appendChild(tr);
            });
        }

    } catch (error) {
        console.error('Error fetching patient history data:', error);
        alert('Could not compile patient medical history lookup.');
    }
};

// Download invoice PDF logic for Doctor Workspace
window.downloadInvoicePDF = async function(billId) {
    try {
        const response = await fetch(`/api/bill-invoice-details/${billId}`);
        if (!response.ok) throw new Error('Invoice details could not be retrieved.');
        const data = await response.json();

        // 1. Map values to off-screen HTML invoice template
        document.getElementById('pdf-invoice-id').innerText = `INV-${data.BILL_ID.toString().padStart(4, '0')}`;
        document.getElementById('pdf-patient-name').innerText = `${data.PATIENT_FIRSTNAME} ${data.PATIENT_LASTNAME}`;
        document.getElementById('pdf-patient-details').innerHTML = `
            Patient ID: PID-${data.PATIENT_ID} | Ph: ${data.PATIENT_PHNO}<br>
            DOB: ${data.PATIENT_DOB} | Blood Group: ${data.PATIENT_BLOODGROUP}
        `;
        document.getElementById('pdf-patient-address').innerText = data.PATIENT_ADDRESS;

        document.getElementById('pdf-doctor-name').innerText = `Dr. ${data.DOCTOR_FIRSTNAME} ${data.DOCTOR_LASTNAME}`;
        document.getElementById('pdf-doctor-spec').innerText = data.DOCTOR_SPECIALIZATION;
        document.getElementById('pdf-visit-type').innerText = data.APPOINTMENT_VISIT_TYPE;
        document.getElementById('pdf-visit-date').innerText = `${data.APPOINTMENT_DATE} (${data.APPOINTMENT_TIME})`;

        // Clinical summary
        document.getElementById('pdf-clinical-symptoms').innerText = data.PRESCRIPTION_SYMPTOMS || 'No symptoms/diagnosis logs saved.';
        
        if (data.MEDICINE_NAME) {
            document.getElementById('pdf-presc-row').style.display = 'table-row';
            document.getElementById('pdf-medicine-name').innerText = data.MEDICINE_NAME;
            document.getElementById('pdf-medicine-dosage').innerText = data.MEDICINE_DOSAGE;
            document.getElementById('pdf-medicine-frequency').innerText = data.MEDICINE_FREQUENCY;
            document.getElementById('pdf-medicine-duration').innerText = data.MEDICINE_DURATION;
        } else {
            document.getElementById('pdf-medicine-name').innerText = 'No medication prescribed.';
            document.getElementById('pdf-medicine-dosage').innerText = '-';
            document.getElementById('pdf-medicine-frequency').innerText = '-';
            document.getElementById('pdf-medicine-duration').innerText = '-';
        }

        // Charges
        document.getElementById('pdf-charge-consult').innerText = `₹${data.CONSULTATION_CHARGES.toFixed(2)}`;
        document.getElementById('pdf-charge-lab').innerText = `₹${data.LAB_CHARGES.toFixed(2)}`;
        document.getElementById('pdf-charge-medicine').innerText = `₹${data.MEDICINE_CHARGES.toFixed(2)}`;
        document.getElementById('pdf-charge-total').innerText = `₹${data.TOTAL_AMOUNT.toFixed(2)}`;

        document.getElementById('pdf-payment-method').innerText = data.PAYMENT_METHOD;
        document.getElementById('pdf-payment-status').innerText = data.PAYMENT_STATUS;
        
        const issuedDate = new Date(data.BILL_DATE).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        document.getElementById('pdf-invoice-date').innerText = issuedDate;

        // 2. Perform PDF generation
        const safeFirstName = (data.PATIENT_FIRSTNAME || '').replace(/[^a-zA-Z0-9]/g, '_');
        const safeLastName = (data.PATIENT_LASTNAME || '').replace(/[^a-zA-Z0-9]/g, '_');
        const opt = {
            margin:       10,
            filename:     `invoice_${safeFirstName}_${safeLastName}_INV-${data.BILL_ID}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const element = document.getElementById('invoice-pdf-template');
        html2pdf().set(opt).from(element).outputPdf('blob').then(function(blob) {
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = opt.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        }).catch(err => {
            console.error('Blob PDF generation error, trying fallback:', err);
            html2pdf().set(opt).from(element).save();
        });

    } catch (err) {
        console.error('Error generating PDF:', err);
        alert('Failed to generate PDF. Check console logs for details.');
    }
};

// Download prescription PDF logic for Doctor Workspace
window.downloadPrescriptionPDF = async function(prescId) {
    try {
        if (!window.currentPatientHistoryData) throw new Error('No patient history records loaded.');
        const data = window.currentPatientHistoryData;
        const presc = data.prescriptions.find(p => p.PRESCRIPTION_ID === prescId);
        if (!presc) throw new Error('Prescription details not found.');

        // Map values to off-screen HTML prescription template
        document.getElementById('pdf-presc-id').innerText = `RX-${presc.PRESCRIPTION_ID.toString().padStart(4, '0')}`;
        document.getElementById('pdf-presc-patient-name').innerText = `${data.patient.PATIENT_FIRSTNAME} ${data.patient.PATIENT_LASTNAME}`;
        document.getElementById('pdf-presc-patient-details').innerHTML = `
            Patient ID: PID-${data.patient.PID} | Ph: ${data.patient.PATIENT_PHNO}<br>
            DOB: ${data.patient.PATIENT_DOB} | Blood Group: ${data.patient.PATIENT_BLOODGROUP}
        `;
        document.getElementById('pdf-presc-patient-address').innerText = data.patient.PATIENT_ADDRESS;

        document.getElementById('pdf-presc-doctor-name').innerText = `Dr. ${presc.DOCTOR_FIRSTNAME} ${presc.DOCTOR_LASTNAME}`;
        document.getElementById('pdf-presc-doctor-spec').innerText = presc.DOCTOR_SPECIALIZATION;
        document.getElementById('pdf-presc-date').innerText = presc.APPOINTMENT_DATE;

        // Clinical summary
        document.getElementById('pdf-presc-symptoms').innerText = presc.SYMPTOMS || 'No symptoms/diagnosis logs saved.';

        // Medicine details
        document.getElementById('pdf-presc-med-name').innerText = presc.MEDICINE_NAME;
        document.getElementById('pdf-presc-med-dosage').innerText = presc.MEDICINE_DOSAGE;
        document.getElementById('pdf-presc-med-freq').innerText = presc.MEDICINE_FREQUENCY;
        document.getElementById('pdf-presc-med-dur').innerText = presc.MEDICINE_DURATION;

        // Perform PDF generation
        const safeFirstName = (data.patient.PATIENT_FIRSTNAME || '').replace(/[^a-zA-Z0-9]/g, '_');
        const safeLastName = (data.patient.PATIENT_LASTNAME || '').replace(/[^a-zA-Z0-9]/g, '_');
        const opt = {
            margin:       10,
            filename:     `prescription_${safeFirstName}_${safeLastName}_RX-${presc.PRESCRIPTION_ID}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const element = document.getElementById('prescription-pdf-template');
        html2pdf().set(opt).from(element).outputPdf('blob').then(function(blob) {
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = opt.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        }).catch(err => {
            console.error('Blob prescription PDF generation error, trying fallback:', err);
            html2pdf().set(opt).from(element).save();
        });

    } catch (err) {
        console.error('Error generating prescription PDF:', err);
        alert('Failed to generate Prescription PDF. Check console logs for details.');
    }
};

// Alternative Native Print Invoice Logic for Doctor Portal
window.printInvoiceAlternative = async function(billId) {
    try {
        const response = await fetch(`/api/bill-invoice-details/${billId}`);
        if (!response.ok) throw new Error('Invoice details could not be retrieved.');
        const data = await response.json();

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups to use the print alternative.');
            return;
        }

        const formattedBillDate = new Date(data.BILL_DATE).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Invoice - INV-${data.BILL_ID}</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { font-family: 'Plus Jakarta Sans', sans-serif; padding: 40px; background-color: #ffffff; color: #0f172a; }
                    .invoice-header { border-bottom: 2px solid #0d9488; padding-bottom: 20px; margin-bottom: 30px; }
                    .invoice-title { color: #0d9488; font-size: 28px; font-weight: 800; }
                    .table-header-custom { background-color: #0d9488 !important; color: white !important; }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="container" style="max-width: 800px;">
                    <div class="d-flex justify-content-between align-items-center invoice-header">
                        <div>
                            <h2 class="m-0 text-primary fw-bold" style="color: #1e3a8a !important;">HOSPITAL MANAGEMENT SYSTEM</h2>
                            <p class="text-muted small m-0 mt-1">123 Healthcare Boulevard, Tech City</p>
                            <p class="text-muted small m-0">Ph: +91 98765 43210 | support@hms.org</p>
                        </div>
                        <div class="text-end">
                            <h1 class="invoice-title m-0">INVOICE</h1>
                            <p class="fw-bold text-secondary m-0">INV-${data.BILL_ID.toString().padStart(4, '0')}</p>
                        </div>
                    </div>

                    <div class="row mb-5">
                        <div class="col-6">
                            <h6 class="text-muted fw-bold mb-2 small text-uppercase">BILL TO</h6>
                            <strong class="fs-5">${data.PATIENT_FIRSTNAME} ${data.PATIENT_LASTNAME}</strong>
                            <div class="text-secondary small mt-1">
                                Patient ID: PID-${data.PATIENT_ID} | Ph: ${data.PATIENT_PHNO}<br>
                                DOB: ${data.PATIENT_DOB} | Blood Group: ${data.PATIENT_BLOODGROUP}
                            </div>
                            <div class="text-secondary small mt-2">
                                <strong>Address:</strong> ${data.PATIENT_ADDRESS}
                            </div>
                        </div>
                        <div class="col-6 text-end">
                            <h6 class="text-muted fw-bold mb-2 small text-uppercase">VISIT DETAILS</h6>
                            <div class="text-secondary small">
                                <strong>Consulting Doctor:</strong> Dr. ${data.DOCTOR_FIRSTNAME} ${data.DOCTOR_LASTNAME}<br>
                                <strong>Specialization:</strong> ${data.DOCTOR_SPECIALIZATION}<br>
                                <strong>Visit Type:</strong> ${data.APPOINTMENT_VISIT_TYPE}<br>
                                <strong>Date & Time:</strong> ${data.APPOINTMENT_DATE} (${data.APPOINTMENT_TIME})
                            </div>
                        </div>
                    </div>

                    <!-- Clinical prescription card -->
                    <div class="card p-3 mb-4 bg-light border-0">
                        <h6 class="fw-bold text-dark mb-2 text-uppercase small" style="border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px;">
                            Medical Prescription & Clinical Summary
                        </h6>
                        <div class="small text-secondary mb-3">
                            <strong>Observed Symptoms / Diagnosis:</strong> ${data.PRESCRIPTION_SYMPTOMS || 'No symptoms/diagnosis logs saved.'}
                        </div>
                        \${data.MEDICINE_NAME ? `
                        <table class="table table-sm table-borderless text-dark m-0" style="font-size: 0.9rem;">
                            <thead>
                                <tr class="border-bottom text-muted">
                                    <th class="py-1">Prescribed Medicine</th>
                                    <th class="py-1">Dosage</th>
                                    <th class="py-1">Frequency</th>
                                    <th class="py-1">Duration</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="py-2"><strong>\${data.MEDICINE_NAME}</strong></td>
                                    <td class="py-2">\${data.MEDICINE_DOSAGE}</td>
                                    <td class="py-2">\${data.MEDICINE_FREQUENCY}</td>
                                    <td class="py-2">\${data.MEDICINE_DURATION}</td>
                                </tr>
                            </tbody>
                        </table>
                        ` : '<div class="text-muted small">No medication prescribed.</div>'}
                    </div>

                    <!-- Invoice Breakdown -->
                    <table class="table table-bordered align-middle mb-5">
                        <thead class="table-header-custom">
                            <tr>
                                <th class="py-2 px-3">Charge Description</th>
                                <th class="py-2 px-3 text-end" style="width: 150px;">Amount ($)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="py-3 px-3">Consultation & Physician Visit Fees</td>
                                <td class="py-3 px-3 text-end">$\${data.CONSULTATION_CHARGES.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td class="py-3 px-3">Diagnostics & Lab Services</td>
                                <td class="py-3 px-3 text-end">$\${data.LAB_CHARGES.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td class="py-3 px-3">Medication & Pharmacy Charges</td>
                                <td class="py-3 px-3 text-end">$\${data.MEDICINE_CHARGES.toFixed(2)}</td>
                            </tr>
                            <tr class="fw-bold fs-5 table-light">
                                <td class="py-3 px-3">TOTAL AMOUNT DUE</td>
                                <td class="py-3 px-3 text-end text-primary" style="color: #0d9488 !important;">$\${data.TOTAL_AMOUNT.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="d-flex justify-content-between align-items-end mt-5">
                        <div class="text-secondary small">
                            <strong>Payment Method:</strong> \${data.PAYMENT_METHOD}<br>
                            <strong>Payment Status:</strong> <span class="fw-bold text-success">\${data.PAYMENT_STATUS}</span><br>
                            <strong>Date Issued:</strong> \${formattedBillDate}
                        </div>
                        <div class="text-center text-muted small">
                            <div style="border-bottom: 1px solid #cbd5e1; width: 180px; margin-bottom: 5px;"></div>
                            Authorized Signatory
                        </div>
                    </div>

                    <div class="text-center border-top pt-4 mt-5 text-muted small">
                        Thank you for choosing our Hospital. Get well soon!
                    </div>
                </div>

                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();

    } catch (err) {
        console.error('Error invoking print alternative:', err);
        alert('Failed to launch printing overlay.');
    }
};

// Alternative Native Print Prescription Logic for Doctor Portal
window.printPrescriptionAlternative = function(prescId) {
    try {
        if (!window.currentPatientHistoryData) throw new Error('No history data loaded.');
        const data = window.currentPatientHistoryData;
        const presc = data.prescriptions.find(p => p.PRESCRIPTION_ID === prescId);
        if (!presc) throw new Error('Prescription details not found.');

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups to use the print alternative.');
            return;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Prescription - RX-${presc.PRESCRIPTION_ID}</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { font-family: 'Plus Jakarta Sans', sans-serif; padding: 40px; background-color: #ffffff; color: #0f172a; }
                    .rx-header { border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 30px; }
                    .rx-title { color: #10b981; font-size: 28px; font-weight: 800; }
                    .table-header-custom { background-color: #10b981 !important; color: white !important; }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="container" style="max-width: 800px;">
                    <div class="d-flex justify-content-between align-items-center rx-header">
                        <div>
                            <h2 class="m-0 text-primary fw-bold" style="color: #064e3b !important;">HOSPITAL MANAGEMENT SYSTEM</h2>
                            <p class="text-muted small m-0 mt-1">123 Healthcare Boulevard, Tech City</p>
                            <p class="text-muted small m-0">Ph: +91 98765 43210 | support@hms.org</p>
                        </div>
                        <div class="text-end">
                            <h1 class="rx-title m-0">PRESCRIPTION</h1>
                            <p class="fw-bold text-secondary m-0">RX-\${presc.PRESCRIPTION_ID.toString().padStart(4, '0')}</p>
                        </div>
                    </div>

                    <div class="row mb-5">
                        <div class="col-6">
                            <h6 class="text-muted fw-bold mb-2 small text-uppercase">PATIENT INFO</h6>
                            <strong class="fs-5">\${data.patient.PATIENT_FIRSTNAME} \${data.patient.PATIENT_LASTNAME}</strong>
                            <div class="text-secondary small mt-1">
                                Patient ID: PID-\${data.patient.PID} | Ph: \${data.patient.PATIENT_PHNO}<br>
                                DOB: \${data.patient.PATIENT_DOB} | Blood Group: \${data.patient.PATIENT_BLOODGROUP}
                            </div>
                            <div class="text-secondary small mt-2">
                                <strong>Address:</strong> \${data.patient.PATIENT_ADDRESS}
                            </div>
                        </div>
                        <div class="col-6 text-end">
                            <h6 class="text-muted fw-bold mb-2 small text-uppercase">PRESCRIBING DOCTOR</h6>
                            <strong class="fs-6">Dr. \${presc.DOCTOR_FIRSTNAME} \${presc.DOCTOR_LASTNAME}</strong>
                            <div class="text-secondary small mt-1">
                                <strong>Specialization:</strong> \${presc.DOCTOR_SPECIALIZATION}<br>
                                <strong>Date:</strong> \${presc.APPOINTMENT_DATE}
                            </div>
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="text-muted fw-bold mb-2 small text-uppercase">Clinical Summary & Symptoms</h6>
                        <div class="p-3 bg-light border rounded small text-dark">
                            \${presc.SYMPTOMS || 'No symptoms/diagnosis logs saved.'}
                        </div>
                    </div>

                    <div class="mb-5">
                        <h6 class="text-muted fw-bold mb-2 small text-uppercase">Prescribed Medications (Rx)</h6>
                        <table class="table table-bordered align-middle">
                            <thead class="table-header-custom">
                                <tr>
                                    <th>Medicine Name</th>
                                    <th>Dosage</th>
                                    <th>Frequency</th>
                                    <th>Duration</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><strong>\${presc.MEDICINE_NAME}</strong></td>
                                    <td>\${presc.MEDICINE_DOSAGE}</td>
                                    <td>\${presc.MEDICINE_FREQUENCY}</td>
                                    <td>\${presc.MEDICINE_DURATION}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="d-flex justify-content-end align-items-end mt-5">
                        <div class="text-center text-muted small">
                            <div style="border-bottom: 1px solid #cbd5e1; width: 180px; margin-bottom: 5px;"></div>
                            Medical Practitioner Signature
                        </div>
                    </div>

                    <div class="text-center border-top pt-4 mt-5 text-muted small">
                        This prescription is valid for the duration specified. Get well soon!
                    </div>
                </div>

                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    };
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();

    } catch (err) {
        console.error('Error invoking print prescription alternative:', err);
        alert('Failed to launch prescription printing overlay.');
    }
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

// Setup change password submit handler
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

            try {
                const response = await fetch('/api/doctor/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ doctorId: LOGGED_IN_DOCTOR_ID, oldPassword, newPassword })
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