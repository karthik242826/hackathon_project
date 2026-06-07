if (sessionStorage.getItem('hms_patient_auth') !== 'true') {
    window.location.href = './patient-login.html';
}

const LOGGED_IN_PATIENT_ID = parseInt(sessionStorage.getItem('hms_patient_id')) || 1;

document.addEventListener('DOMContentLoaded', () => {
    loadPatientDashboard();

    async function loadPatientDashboard() {
        try {
            const response = await fetch(`/api/patient-dashboard/${LOGGED_IN_PATIENT_ID}`);
            if (!response.ok) throw new Error('Failed to retrieve patient portal datasets');
            const data = await response.json();
            window.patientDashboardData = data;

            // Bind profile data
            document.getElementById('patient-fullname').innerText = `${data.patient.PATIENT_FIRSTNAME} ${data.patient.PATIENT_LASTNAME}`;
            document.getElementById('detail-pid').innerText = `PID-${data.patient.PID}`;
            document.getElementById('detail-dob').innerText = data.patient.PATIENT_DOB;
            document.getElementById('detail-gender').innerText = data.patient.PATIENT_GENDER;
            document.getElementById('detail-blood').innerText = data.patient.PATIENT_BLOODGROUP;
            document.getElementById('detail-phone').innerText = data.patient.PATIENT_PHNO;
            document.getElementById('detail-address').innerText = data.patient.PATIENT_ADDRESS;

            // Bind metrics
            document.getElementById('metric-visits').innerText = data.appointments.length;
            document.getElementById('metric-prescriptions').innerText = data.prescriptions.length;
            
            const unpaidCount = data.bills.filter(b => b.PAYMENT_STATUS === 'PENDING').length;
            document.getElementById('metric-unpaid').innerText = unpaidCount;

            // Render appointments table
            renderAppointments(data.appointments);

            // Render prescriptions
            renderPrescriptions(data.prescriptions);

            // Render bills table
            renderBills(data.bills);

        } catch (error) {
            console.error('Error loading patient dashboard:', error);
        }
    }

    function renderAppointments(appointments) {
        const tbody = document.getElementById('patient-appts-tbody');
        tbody.innerHTML = '';

        if (appointments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No appointments found.</td></tr>';
            return;
        }

        appointments.forEach(a => {
            const tr = document.createElement('tr');
            let badge = '';
            if (a.APPOINTMENT_STATUS === 'SCHEDULED') {
                badge = '<span class="badge-scheduled">Scheduled</span>';
            } else if (a.APPOINTMENT_STATUS === 'COMPLETED') {
                badge = '<span class="badge-completed">Completed</span>';
            } else {
                badge = '<span class="badge bg-danger">Cancelled</span>';
            }

            tr.innerHTML = `
                <td>Dr. ${a.DOCTOR_FIRSTNAME} ${a.DOCTOR_LASTNAME}</td>
                <td><code class="text-secondary">${a.DOCTOR_SPECIALIZATION}</code></td>
                <td>${a.APPOINTMENT_DATE} (${a.APPOINTMENT_TIME})</td>
                <td><span class="badge bg-light text-dark border">${a.APPOINTMENT_VISIT_TYPE}</span></td>
                <td>${badge}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderPrescriptions(prescriptions) {
        const container = document.getElementById('prescriptions-container');
        container.innerHTML = '';

        if (prescriptions.length === 0) {
            container.innerHTML = '<p class="text-muted text-center py-3">No active prescriptions located.</p>';
            return;
        }

        prescriptions.forEach(p => {
            let medicinesListHTML = '';
            try {
                const parsedMeds = JSON.parse(p.MEDICINE_NAME);
                if (Array.isArray(parsedMeds)) {
                    parsedMeds.forEach(m => {
                        medicinesListHTML += `
                            <div class="mb-2 pb-2 border-bottom">
                                <h6 class="fw-bold text-primary m-0">${m.name}</h6>
                                <div class="row g-2 text-center mt-1">
                                    <div class="col-4 border-end">
                                        <small class="text-muted d-block">Dosage</small>
                                        <strong>${m.dosage}</strong>
                                    </div>
                                    <div class="col-4 border-end">
                                        <small class="text-muted d-block">Frequency</small>
                                        <strong>${m.frequency}</strong>
                                    </div>
                                    <div class="col-4">
                                        <small class="text-muted d-block">Duration</small>
                                        <strong>${m.duration}</strong>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                } else throw new Error();
            } catch(e) {
                medicinesListHTML = `
                    <div class="mb-2 pb-2 border-bottom">
                        <h6 class="fw-bold text-primary m-0">${p.MEDICINE_NAME}</h6>
                        <div class="row g-2 text-center mt-1">
                            <div class="col-4 border-end">
                                <small class="text-muted d-block">Dosage</small>
                                <strong>${p.MEDICINE_DOSAGE}</strong>
                            </div>
                            <div class="col-4 border-end">
                                <small class="text-muted d-block">Frequency</small>
                                <strong>${p.MEDICINE_FREQUENCY}</strong>
                            </div>
                            <div class="col-4">
                                <small class="text-muted d-block">Duration</small>
                                <strong>${p.MEDICINE_DURATION}</strong>
                            </div>
                        </div>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = 'prescription-card';
            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-start mb-3 border-bottom pb-2">
                    <div>
                        <small class="text-muted">Prescribed by Dr. ${p.DOCTOR_FIRSTNAME} ${p.DOCTOR_LASTNAME} (${p.DOCTOR_SPECIALIZATION})</small>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-light text-dark border">Date: ${p.APPOINTMENT_DATE}</span>
                        <button class="btn btn-sm btn-outline-success" style="font-size: 0.85rem;" onclick="downloadPrescriptionPDF(${p.PRESCRIPTION_ID})">
                            <i class="bi bi-file-earmark-pdf-fill"></i> PDF
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" style="font-size: 0.85rem;" onclick="printPrescriptionAlternative(${p.PRESCRIPTION_ID})">
                            <i class="bi bi-printer-fill"></i> Print
                        </button>
                    </div>
                </div>
                ${medicinesListHTML}
                <div>
                    <span class="text-muted small d-block">Recorded Symptoms / Diagnosis</span>
                    <p class="m-0 small fw-bold">${p.SYMPTOMS}</p>
                </div>
            `;
            container.appendChild(card);
        });
    }

    function renderBills(bills) {
        const tbody = document.getElementById('patient-bills-tbody');
        tbody.innerHTML = '';

        if (bills.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No invoices found.</td></tr>';
            return;
        }

        bills.forEach(b => {
            const tr = document.createElement('tr');
            const formattedDate = new Date(b.BILL_DATE).toLocaleDateString();
            const badge = b.PAYMENT_STATUS === 'PAID' 
                ? '<span class="badge-paid">Paid</span>' 
                : '<span class="badge-pending">Pending</span>';

            tr.innerHTML = `
                <td><b>INV-${b.BILL_ID}</b></td>
                <td>${formattedDate}</td>
                <td>₹${b.CONSULTATION_CHARGES.toFixed(2)}</td>
                <td>₹${b.LAB_CHARGES.toFixed(2)}</td>
                <td>₹${b.MEDICINE_CHARGES.toFixed(2)}</td>
                <td><b>₹${b.TOTAL_AMOUNT.toFixed(2)}</b></td>
                <td>${badge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" style="font-size: 0.85rem;" onclick="downloadInvoicePDF(${b.BILL_ID})">
                        <i class="bi bi-file-earmark-pdf-fill"></i> PDF
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" style="font-size: 0.85rem;" onclick="printInvoiceAlternative(${b.BILL_ID})">
                        <i class="bi bi-printer-fill"></i> Print
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
});

// Download invoice PDF logic
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
        
        const tbody = document.getElementById('pdf-presc-tbody');
        if (tbody) tbody.innerHTML = '';
        if (data.MEDICINE_NAME) {
            try {
                const parsedMeds = JSON.parse(data.MEDICINE_NAME);
                if(Array.isArray(parsedMeds)) {
                    parsedMeds.forEach(m => {
                        tbody.innerHTML += `<tr style="color: #0f172a;">
                            <td style="padding: 8px 0;">${m.name}</td>
                            <td style="padding: 8px 0;">${m.dosage}</td>
                            <td style="padding: 8px 0;">${m.frequency}</td>
                            <td style="padding: 8px 0;">${m.duration}</td>
                        </tr>`;
                    });
                } else throw new Error();
            } catch(e) {
                tbody.innerHTML = `<tr style="color: #0f172a;">
                    <td style="padding: 8px 0;">${data.MEDICINE_NAME}</td>
                    <td style="padding: 8px 0;">${data.MEDICINE_DOSAGE}</td>
                    <td style="padding: 8px 0;">${data.MEDICINE_FREQUENCY}</td>
                    <td style="padding: 8px 0;">${data.MEDICINE_DURATION}</td>
                </tr>`;
            }
        } else {
            if (tbody) tbody.innerHTML = `<tr style="color: #0f172a;">
                <td style="padding: 8px 0;">No medication prescribed.</td>
                <td style="padding: 8px 0;">-</td>
                <td style="padding: 8px 0;">-</td>
                <td style="padding: 8px 0;">-</td>
            </tr>`;
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

// Download prescription PDF logic
window.downloadPrescriptionPDF = async function(prescId) {
    try {
        if (!window.patientDashboardData) throw new Error('No patient dashboard data loaded.');
        const data = window.patientDashboardData;
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

// Alternative Native Print Invoice Logic
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

        let medicinesListHTML = '';
        try {
            const parsedMeds = JSON.parse(data.MEDICINE_NAME);
            if (Array.isArray(parsedMeds)) {
                parsedMeds.forEach(m => {
                    medicinesListHTML += `<tr>
                        <td class="py-2"><strong>${m.name}</strong></td>
                        <td class="py-2">${m.dosage}</td>
                        <td class="py-2">${m.frequency}</td>
                        <td class="py-2">${m.duration}</td>
                    </tr>`;
                });
            } else throw new Error();
        } catch(e) {
            medicinesListHTML = `<tr>
                <td class="py-2"><strong>${data.MEDICINE_NAME}</strong></td>
                <td class="py-2">${data.MEDICINE_DOSAGE}</td>
                <td class="py-2">${data.MEDICINE_FREQUENCY}</td>
                <td class="py-2">${data.MEDICINE_DURATION}</td>
            </tr>`;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Invoice - INV-${data.BILL_ID}</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { font-family: 'Plus Jakarta Sans', sans-serif; padding: 40px; background-color: #ffffff; color: #0f172a; }
                    .invoice-header { border-bottom: 2px solid #0284c7; padding-bottom: 20px; margin-bottom: 30px; }
                    .invoice-title { color: #0284c7; font-size: 28px; font-weight: 800; }
                    .table-header-custom { background-color: #0284c7 !important; color: white !important; }
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
                        ${data.MEDICINE_NAME ? `
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
                                \${medicinesListHTML}
                            </tbody>
                        </table>
                        ` : '<div class="text-muted small">No medication prescribed.</div>'}
                    </div>

                    <!-- Invoice Breakdown -->
                    <table class="table table-bordered align-middle mb-5">
                        <thead class="table-header-custom">
                            <tr>
                                <th class="py-2 px-3">Charge Description</th>
                                <th class="py-2 px-3 text-end" style="width: 150px;">Amount (₹)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="py-3 px-3">Consultation & Physician Visit Fees</td>
                                <td class="py-3 px-3 text-end">₹${data.CONSULTATION_CHARGES.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td class="py-3 px-3">Diagnostics & Lab Services</td>
                                <td class="py-3 px-3 text-end">₹${data.LAB_CHARGES.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td class="py-3 px-3">Medication & Pharmacy Charges</td>
                                <td class="py-3 px-3 text-end">₹${data.MEDICINE_CHARGES.toFixed(2)}</td>
                            </tr>
                            <tr class="fw-bold fs-5 table-light">
                                <td class="py-3 px-3">TOTAL AMOUNT DUE</td>
                                <td class="py-3 px-3 text-end text-primary" style="color: #0d9488 !important;">₹${data.TOTAL_AMOUNT.toFixed(2)}</td>
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

// Alternative Native Print Prescription Logic
window.printPrescriptionAlternative = function(prescId) {
    try {
        if (!window.patientDashboardData) throw new Error('No patient dashboard data loaded.');
        const data = window.patientDashboardData;
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
                const response = await fetch('/api/patient/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ patientId: LOGGED_IN_PATIENT_ID, oldPassword, newPassword })
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
