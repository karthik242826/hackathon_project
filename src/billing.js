document.addEventListener('DOMContentLoaded', () => {
    const billingForm = document.getElementById('billingForm');
    const appointmentSelect = document.getElementById('appointment-select');
    const consultationInput = document.getElementById('consultation-charges');
    const labInput = document.getElementById('lab-charges');
    const medicineInput = document.getElementById('medicine-charges');
    const totalInput = document.getElementById('total-amount');
    const billsTbody = document.getElementById('bills-tbody');

    // Auto calculate total on charge input changes
    const chargeInputs = document.querySelectorAll('.charge-input');
    chargeInputs.forEach(input => {
        input.addEventListener('input', calculateTotal);
    });

    function calculateTotal() {
        const consultation = parseFloat(consultationInput.value) || 0;
        const lab = parseFloat(labInput.value) || 0;
        const medicine = parseFloat(medicineInput.value) || 0;
        totalInput.value = (consultation + lab + medicine).toFixed(2);
    }

    // Auto-load prescription preview when appointment selection changes
    appointmentSelect.addEventListener('change', async () => {
        const apptId = appointmentSelect.value;
        const previewDiv = document.getElementById('prescription-preview');
        
        if (!apptId) {
            previewDiv.classList.add('d-none');
            return;
        }
        
        try {
            const response = await fetch(`/api/prescription-by-appointment/${apptId}`);
            if (response.ok) {
                const p = await response.json();
                if (p) {
                    document.getElementById('prev-doc-name').innerText = `Dr. ${p.DOCTOR_FIRSTNAME} ${p.DOCTOR_LASTNAME} (${p.DOCTOR_SPECIALIZATION})`;
                    document.getElementById('prev-symptoms').innerText = p.SYMPTOMS;
                    let medHTML = '';
                    try {
                        const parsedMeds = JSON.parse(p.MEDICINE_NAME);
                        if (Array.isArray(parsedMeds)) {
                            parsedMeds.forEach(m => {
                                medHTML += `<div class="mb-1 border-bottom border-secondary-subtle pb-1"><strong>${m.name}</strong> - ${m.dosage} / ${m.frequency} / ${m.duration}</div>`;
                            });
                        } else throw new Error();
                    } catch(e) {
                        medHTML = `<div class="mb-1"><strong>${p.MEDICINE_NAME}</strong> - ${p.MEDICINE_DOSAGE} / ${p.MEDICINE_FREQUENCY} / ${p.MEDICINE_DURATION}</div>`;
                    }
                    document.getElementById('prev-medicine-list').innerHTML = medHTML;
                    previewDiv.classList.remove('d-none');
                } else {
                    previewDiv.classList.add('d-none');
                }
            } else {
                previewDiv.classList.add('d-none');
            }
        } catch (err) {
            console.error('Error fetching prescription preview:', err);
            previewDiv.classList.add('d-none');
        }
    });

    // Load form dropdown data and existing invoices
    loadBillingData();

    async function loadBillingData() {
        try {
            // Load appointments
            const apptResponse = await fetch('/api/appointments');
            if (apptResponse.ok) {
                const appointments = await apptResponse.json();
                appointmentSelect.innerHTML = '<option value="" disabled selected>Select patient visit...</option>';
                appointments.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = a.AID;
                    opt.dataset.patientId = a.PATIENT_ID;
                    opt.textContent = `${a.PATIENT_FIRSTNAME} ${a.PATIENT_LASTNAME} (Date: ${a.APPOINTMENT_DATE} - Status: ${a.APPOINTMENT_STATUS})`;
                    appointmentSelect.appendChild(opt);
                });
            } else {
                appointmentSelect.innerHTML = '<option value="" disabled>Error loading appointments</option>';
            }

            // Load generated bills list
            const billsResponse = await fetch('/api/bills');
            if (billsResponse.ok) {
                const bills = await billsResponse.json();
                renderBillsTable(bills);
            } else {
                billsTbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading generated bills from server.</td></tr>';
            }
        } catch (error) {
            console.error('Error loading billing dashboard data:', error);
            alert('A database fetch error occurred. Please check console logs.');
        }
    }

    function renderBillsTable(bills) {
        billsTbody.innerHTML = '';
        if (bills.length === 0) {
            billsTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No generated bills found.</td></tr>';
            return;
        }

        bills.forEach(bill => {
            const tr = document.createElement('tr');
            // Format date from millisecond integer
            const formattedDate = new Date(bill.BILL_DATE).toLocaleDateString();
            const statusBadge = bill.PAYMENT_STATUS === 'PAID' 
                ? `<span class="badge-paid">Paid</span>` 
                : `<span class="badge-pending">Pending</span>`;

            // UPI Pay button — shown only for PENDING bills
            const payBtn = bill.PAYMENT_STATUS !== 'PAID'
                ? `<button class="btn-upi-pay" id="upi-btn-${bill.BILL_ID}" onclick="initiatePayment(${bill.BILL_ID}, ${bill.TOTAL_AMOUNT}, '${bill.PATIENT_FIRSTNAME} ${bill.PATIENT_LASTNAME}')">
                      <i class="bi bi-phone-fill"></i> Pay via UPI
                   </button>`
                : `<span class="text-success fw-semibold" style="font-size:0.8rem;"><i class="bi bi-check-circle-fill"></i> Settled</span>`;
            
            tr.innerHTML = `
                <td><b>INV-${bill.BILL_ID}</b></td>
                <td>${bill.PATIENT_FIRSTNAME} ${bill.PATIENT_LASTNAME}</td>
                <td>${formattedDate}</td>
                <td><b>₹${bill.TOTAL_AMOUNT.toFixed(2)}</b></td>
                <td><code class="text-secondary">${bill.PAYMENT_METHOD}</code></td>
                <td>${statusBadge}</td>
                <td>
                    ${payBtn}
                    <button class="btn btn-sm btn-outline-primary ms-1" style="font-size: 0.85rem;" onclick="downloadInvoicePDF(${bill.BILL_ID})">
                        <i class="bi bi-file-earmark-pdf-fill"></i> PDF
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" style="font-size: 0.85rem;" onclick="printInvoiceAlternative(${bill.BILL_ID})">
                        <i class="bi bi-printer-fill"></i> Print
                    </button>
                </td>
            `;
            billsTbody.appendChild(tr);
        });
    }

    billingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const selectedOption = appointmentSelect.options[appointmentSelect.selectedIndex];
        if (!selectedOption || !selectedOption.dataset.patientId) {
            alert('Please select a valid appointment for billing.');
            return;
        }

        const payload = {
            patient_id: parseInt(selectedOption.dataset.patientId),
            appointment_id: parseInt(appointmentSelect.value),
            consultation_charges: parseFloat(consultationInput.value) || 0,
            lab_charges: parseFloat(labInput.value) || 0,
            medicine_charges: parseFloat(medicineInput.value) || 0,
            total_amount: parseFloat(totalInput.value) || 0,
            payment_method: document.getElementById('payment-method').value,
            payment_status: document.getElementById('payment-status').value
        };

        try {
            const response = await fetch('/api/add-bill', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                alert(`Invoice successfully saved! Invoice ID: INV-${result.id}`);
                billingForm.reset();
                document.getElementById('prescription-preview').classList.add('d-none'); // hide preview
                calculateTotal(); // reset total amount calculator input
                // Reload dashboard data instantly
                loadBillingData();
            } else {
                alert(result.error || 'Failed to record invoice.');
            }
        } catch (error) {
            console.error('Error in invoice commit pipeline:', error);
            alert('A database connection error occurred. Check server console.');
        }
    });
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
                if (Array.isArray(parsedMeds)) {
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
                                 ${medicinesListHTML}
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
                             <strong>Payment Method:</strong> ${data.PAYMENT_METHOD}<br>
                             <strong>Payment Status:</strong> <span class="fw-bold text-success">${data.PAYMENT_STATUS}</span><br>
                             <strong>Date Issued:</strong> ${formattedBillDate}
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
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();

    } catch (err) {
        console.error('Error invoking print alternative:', err);
        alert('Failed to launch printing overlay.');
    }
};

// ============================================================
// Razorpay UPI Payment Flow
// ============================================================

// Inject payment success toast once
(function injectPaymentToast() {
    const toast = document.createElement('div');
    toast.id = 'paymentToast';
    toast.className = 'payment-toast';
    toast.innerHTML = `<i class="bi bi-check-circle-fill" style="font-size:1.2rem;"></i><span id="paymentToastMsg">Payment successful!</span>`;
    document.body.appendChild(toast);
})();

function showPaymentToast(msg) {
    const toast = document.getElementById('paymentToast');
    document.getElementById('paymentToastMsg').textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

async function initiatePayment(billId, amount, patientName) {
    const btn = document.getElementById(`upi-btn-${billId}`);
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Opening...`; }

    try {
        // Step 1: Get Razorpay config (key_id) from server
        const configRes = await fetch('/api/payment/config');
        const config = await configRes.json();

        if (!config.configured) {
            alert('⚠️ Razorpay is not configured yet.\n\nPlease add your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the .env file and restart the server.\n\nGet keys at: https://razorpay.com → Settings → API Keys');
            if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-phone-fill"></i> Pay via UPI`; }
            return;
        }

        // Step 2: Create Razorpay order on backend
        const orderRes = await fetch('/api/payment/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billId, amount, currency: 'INR' })
        });
        const orderData = await orderRes.json();

        if (!orderRes.ok || !orderData.success) {
            alert('Failed to create payment order: ' + (orderData.error || 'Unknown error'));
            if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-phone-fill"></i> Pay via UPI`; }
            return;
        }

        // Step 3: Open Razorpay checkout popup
        const options = {
            key: config.keyId,
            amount: orderData.order.amount,
            currency: 'INR',
            name: 'HMS Hospital',
            description: `Invoice INV-${billId}`,
            image: './hearth-beat-line-icon-health-medical-heartbeat-symbol-isolated-white-background-hospital-logo-vector-illustration-209787695-removebg-preview.png',
            order_id: orderData.order.id,
            handler: async function(response) {
                // Step 4: Verify payment signature on backend & update DB
                try {
                    const verifyRes = await fetch('/api/payment/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            razorpay_order_id:   response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature:  response.razorpay_signature,
                            billId
                        })
                    });
                    const verifyData = await verifyRes.json();
                    if (verifyRes.ok && verifyData.success) {
                        showPaymentToast(`✅ INV-${billId} Paid — ₹${amount.toFixed(2)} via UPI`);
                        // Reload billing dashboard to reflect PAID status
                        setTimeout(() => window.location.reload(), 1500);
                    } else {
                        alert('Payment received but verification failed: ' + (verifyData.error || 'Unknown error'));
                    }
                } catch (verifyErr) {
                    alert('Network error during payment verification.');
                }
            },
            prefill: {
                name: patientName,
                email: '',
                contact: ''
            },
            theme: {
                color: '#7c3aed'
            },
            modal: {
                ondismiss: function() {
                    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-phone-fill"></i> Pay via UPI`; }
                }
            }
        };

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function(response) {
            alert(`Payment failed: ${response.error.description}`);
            if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-phone-fill"></i> Pay via UPI`; }
        });
        rzp.open();

    } catch (err) {
        console.error('Payment initiation error:', err);
        alert('Payment initiation failed. Check console for details.');
        if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-phone-fill"></i> Pay via UPI`; }
    }
}

