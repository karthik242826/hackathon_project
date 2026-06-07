const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const Database = require('better-sqlite3');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ── EMAIL TRANSPORTER SETUP ──────────────────────────────────────────────────
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const EMAIL_FROM = `"${process.env.EMAIL_FROM_NAME || 'HMS Hospital'}" <${process.env.EMAIL_USER}>`;

async function sendHospitalEmail({ to, subject, html }) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || 
        process.env.EMAIL_USER.includes('your_gmail')) {
        console.log(`\n📧 [EMAIL NOT CONFIGURED] Would send to: ${to}`);
        console.log(`   Subject: ${subject}\n`);
        return { simulated: true };
    }
    return emailTransporter.sendMail({ from: EMAIL_FROM, to, subject, html });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Connect directly to your existing database file
const db = new Database(path.join(__dirname, 'hms.db'), { verbose: console.log });

// Middleware configurations
app.use(express.json());

// Session validation helper for protected HTML static routes
function getSessionFromCookie(req) {
    if (!req.headers.cookie) return null;
    const match = req.headers.cookie.match(/hms_session=([^;]+)/);
    return match ? match[1] : null;
}

// Helper to get redirect login paths
function getRedirectLoginPath(filePath) {
    if (filePath === '/admin.html') return '/admin-login.html';
    if (filePath === '/doctor.html') return '/doctor-login.html';
    if (filePath === '/patient.html') return '/patient-login.html';
    return '/receptionist-login.html';
}

// Middleware to secure static HTML files
app.use((req, res, next) => {
    const filePath = req.path;
    const protectedFiles = [
        '/admin.html',
        '/doctor.html',
        '/receptionist.html',
        '/patient.html',
        '/billing.html',
        '/booking.html'
    ];
    
    if (protectedFiles.includes(filePath)) {
        const sessionId = getSessionFromCookie(req);
        const loginPath = getRedirectLoginPath(filePath);
        if (!sessionId) {
            return res.redirect(loginPath);
        }
        try {
            const session = db.prepare('SELECT ROLE FROM SESSIONS WHERE SESSION_ID = ? AND EXPIRY > ?').get(sessionId, Date.now());
            if (!session) {
                return res.redirect(loginPath);
            }
            
            // Authorization checks per page
            if (filePath === '/admin.html' && session.ROLE !== 'admin') return res.redirect('/admin-login.html');
            if (filePath === '/doctor.html' && session.ROLE !== 'doctor') return res.redirect('/doctor-login.html');
            if (filePath === '/receptionist.html' && session.ROLE !== 'receptionist') return res.redirect('/receptionist-login.html');
            if (filePath === '/patient.html' && session.ROLE !== 'patient') return res.redirect('/patient-login.html');
            if (filePath === '/billing.html' && !['receptionist', 'admin'].includes(session.ROLE)) return res.redirect('/receptionist-login.html');
            if (filePath === '/booking.html' && !['receptionist', 'admin'].includes(session.ROLE)) return res.redirect('/receptionist-login.html');
        } catch (err) {
            return res.redirect(loginPath);
        }
    }
    next();
});

app.use(express.static(path.join(__dirname))); 

// Helper: Secure SHA-256 hashing functions to prevent plain-text credential leaks
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Authentication middleware for API routes
function requireAuth(roles = []) {
    return (req, res, next) => {
        const sessionId = getSessionFromCookie(req);
        if (!sessionId) return res.status(401).json({ error: 'Unauthorized. No active session.' });
        
        try {
            const session = db.prepare('SELECT USERNAME, ROLE FROM SESSIONS WHERE SESSION_ID = ? AND EXPIRY > ?')
                              .get(sessionId, Date.now());
            if (!session) return res.status(401).json({ error: 'Unauthorized. Session expired or invalid.' });
            
            if (roles.length > 0 && !roles.includes(session.ROLE)) {
                return res.status(403).json({ error: 'Forbidden. Insufficient permissions.' });
            }
            
            req.user = session;
            next();
        } catch (err) {
            return res.status(500).json({ error: 'Internal auth processing error.' });
        }
    };
}

// ==========================================
// 1. API ROUTE: READ PIPELINE (Dashboard View)
// ==========================================
app.get('/api/doctor-dashboard/:id', requireAuth(['doctor', 'admin']), (req, res) => {
    const doctorId = req.params.id;
    if (req.user.ROLE === 'doctor') {
        const doctorObj = db.prepare('SELECT D_ID FROM DOCTOR WHERE DOCTOR_USERNAME = ?').get(req.user.USERNAME);
        if (!doctorObj || doctorObj.D_ID.toString() !== doctorId.toString()) {
            return res.status(403).json({ error: 'Forbidden. You can only view your own dashboard.' });
        }
    }
    try {
        const doctorStatement = db.prepare('SELECT D_ID, DOCTOR_FIRSTNAME, DOCTOR_LASTNAME, DOCTOR_SPECIALIZATION, DOCTOR_AVAILABILITY, DOCTOR_PHNO, DOCTOR_USERNAME, DOCTOR_EMAIL FROM DOCTOR WHERE D_ID = ?');
        const doctor = doctorStatement.get(doctorId);

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor record not located.' });
        }

        const appointmentStatement = db.prepare(`
            SELECT a.AID, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE, a.APPOINTMENT_STATUS, a.PATIENT_ID,
                    p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME
            FROM APPOINTMENT a
            JOIN PATIENT p ON a.PATIENT_ID = p.PID
            WHERE a.DOCTOR_ID = ?
            ORDER BY a.APPOINTMENT_TIME ASC
        `);
        const appointments = appointmentStatement.all(doctorId);

        res.json({ doctor, appointments });
    } catch (err) {
        console.error('Database query structural exception:', err);
        res.status(500).json({ error: 'Internal server query pipeline failed.' });
    }
});

// ==========================================
// 2. API ROUTE: WRITE PIPELINE (Prescription Commit)
// ==========================================
app.post('/api/save-prescription', requireAuth(['doctor']), (req, res) => {
    const data = req.body;
    const doctorObj = db.prepare('SELECT D_ID FROM DOCTOR WHERE DOCTOR_USERNAME = ?').get(req.user.USERNAME);
    if (!doctorObj || doctorObj.D_ID !== data.doctor_id) {
        return res.status(403).json({ error: 'Forbidden. You can only prescribe for your own appointments.' });
    }
    const executePrescriptionTx = db.transaction((p) => {
        const insertPrescription = db.prepare(`
            INSERT INTO PRESCRIPTION (APPOINTMENT_ID, PATIENT_ID, DOCTOR_ID, SYMPTOMS, MEDICINE_NAME, MEDICINE_DOSAGE, MEDICINE_FREQUENCY, MEDICINE_DURATION)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const symptomsCombined = p.diagnosis ? `Diagnosis: ${p.diagnosis}. Symptoms: ${p.symptoms}` : p.symptoms;
        
        insertPrescription.run(
            p.appointment_id, p.patient_id, p.doctor_id, symptomsCombined, 
            p.medicine_name, p.dosage, p.frequency, p.duration
        );

        const updateAppointmentStatus = db.prepare(`
            UPDATE APPOINTMENT SET APPOINTMENT_STATUS = 'COMPLETED' WHERE AID = ?
        `);
        updateAppointmentStatus.run(p.appointment_id);
    });

    try {
        executePrescriptionTx(data);
        res.sendStatus(200);
    } catch (err) {
        console.error('Database transaction failure processing record write:', err);
        res.status(500).json({ error: 'Database transaction crashed or was dropped.' });
    }
});

// ==========================================
// 4. API ROUTES FOR PATIENTS, SCHEDULING, AND BILLING
// ==========================================

app.post('/api/add-patient', requireAuth(['receptionist', 'admin']), (req, res) => {
    const { firstname, lastname, dob, gender, bloodgroup, address, phno, username, password, email } = req.body;
    if (!firstname || !lastname || !dob || !gender || !bloodgroup || !address || !phno || !username || !password || !email) {
        return res.status(400).json({ error: 'All fields, including email verification routing keys, are mandatory.' });
    }
    try {
        const existing = db.prepare('SELECT PID FROM PATIENT WHERE PATIENT_USERNAME = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: `Patient username "${username}" is already taken.` });
        }

        const stmt = db.prepare(`
            INSERT INTO PATIENT (PATIENT_FIRSTNAME, PATIENT_LASTNAME, PATIENT_DOB, PATIENT_GENDER, PATIENT_BLOODGROUP, PATIENT_ADDRESS, PATIENT_PHNO, PATIENT_USERNAME, PATIENT_PASSWORD, PATIENT_EMAIL)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        // Securely hash user input text right into data layers
        const info = stmt.run(firstname, lastname, dob, gender, bloodgroup, address, phno, username, hashPassword(password), email);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to add patient:', err);
        res.status(500).json({ error: 'Failed to add patient record.' });
    }
});

app.get('/api/patients', requireAuth(['receptionist', 'admin', 'doctor']), (req, res) => {
    try {
        const patients = db.prepare('SELECT PID, PATIENT_FIRSTNAME, PATIENT_LASTNAME, PATIENT_DOB, PATIENT_GENDER, PATIENT_BLOODGROUP, PATIENT_ADDRESS, PATIENT_PHNO, PATIENT_USERNAME, PATIENT_EMAIL FROM PATIENT').all();
        res.json(patients);
    } catch (err) {
        console.error('Failed to retrieve patients:', err);
        res.status(500).json({ error: 'Failed to retrieve patients.' });
    }
});

app.get('/api/doctors', (req, res) => {
    try {
        const doctors = db.prepare('SELECT D_ID, DOCTOR_FIRSTNAME, DOCTOR_LASTNAME, DOCTOR_SPECIALIZATION, DOCTOR_AVAILABILITY, DOCTOR_PHNO, DOCTOR_USERNAME, DOCTOR_EMAIL FROM DOCTOR').all();
        res.json(doctors);
    } catch (err) {
        console.error('Failed to retrieve doctors:', err);
        res.status(500).json({ error: 'Failed to retrieve doctors.' });
    }
});

app.post('/api/add-appointment', requireAuth(['receptionist', 'admin', 'patient']), (req, res) => {
    const { patient_id, doctor_id, appointment_date, appointment_time, appointment_visit_type } = req.body;
    if (req.user.ROLE === 'patient') {
        const patientObj = db.prepare('SELECT PID FROM PATIENT WHERE PATIENT_USERNAME = ?').get(req.user.USERNAME);
        if (!patientObj || patientObj.PID.toString() !== patient_id.toString()) {
            return res.status(403).json({ error: 'Forbidden. You can only book for yourself.' });
        }
    }
    try {
        const stmt = db.prepare(`
            INSERT INTO APPOINTMENT (PATIENT_ID, DOCTOR_ID, APPOINTMENT_DATE, APPOINTMENT_TIME, APPOINTMENT_VISIT_TYPE, APPOINTMENT_STATUS)
            VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
        `);
        const info = stmt.run(patient_id, doctor_id, appointment_date, appointment_time, appointment_visit_type);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to schedule appointment:', err);
        res.status(500).json({ error: 'Failed to schedule appointment.' });
    }
});

app.get('/api/appointments', requireAuth(['receptionist', 'admin', 'doctor']), (req, res) => {
    try {
        const appointments = db.prepare(`
            SELECT a.AID, a.APPOINTMENT_DATE, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE, a.APPOINTMENT_STATUS,
                   p.PID as PATIENT_ID, p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME,
                   d.D_ID as DOCTOR_ID, d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME
            FROM APPOINTMENT a
            JOIN PATIENT p ON a.PATIENT_ID = p.PID
            JOIN DOCTOR d ON a.DOCTOR_ID = d.D_ID
            ORDER BY a.AID DESC
        `).all();
        res.json(appointments);
    } catch (err) {
        console.error('Failed to retrieve appointments:', err);
        res.status(500).json({ error: 'Failed to retrieve appointments.' });
    }
});

app.post('/api/add-bill', requireAuth(['receptionist', 'admin']), (req, res) => {
    const { patient_id, appointment_id, consultation_charges, lab_charges, medicine_charges, total_amount, payment_method, payment_status } = req.body;
    try {
        const stmt = db.prepare(`
            INSERT INTO BILLS (PATIENT_ID, APPOINTMENT_ID, BILL_DATE, CONSULTATION_CHARGES, LAB_CHARGES, MEDICINE_CHARGES, TOTAL_AMOUNT, PAYMENT_METHOD, PAYMENT_STATUS)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(patient_id, appointment_id, Date.now(), consultation_charges, lab_charges, medicine_charges, total_amount, payment_method, payment_status);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to generate invoice:', err);
        res.status(500).json({ error: 'Failed to generate invoice.' });
    }
});

app.get('/api/bills', requireAuth(['receptionist', 'admin', 'patient']), (req, res) => {
    try {
        let bills;
        if (req.user.ROLE === 'patient') {
            bills = db.prepare(`
                SELECT b.*, p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME, a.APPOINTMENT_DATE FROM BILLS b
                JOIN PATIENT p ON b.PATIENT_ID = p.PID
                JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
                WHERE p.PATIENT_USERNAME = ?
                ORDER BY b.BILL_ID DESC
            `).all(req.user.USERNAME);
        } else {
            bills = db.prepare(`
                SELECT b.*, p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME, a.APPOINTMENT_DATE FROM BILLS b
                JOIN PATIENT p ON b.PATIENT_ID = p.PID
                JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
                ORDER BY b.BILL_ID DESC
            `).all();
        }
        res.json(bills);
    } catch (err) {
        console.error('Failed to retrieve bills:', err);
        res.status(500).json({ error: 'Failed to retrieve bills.' });
    }
});

// ==========================================
// 5. ADMIN API ROUTES — Doctor & Password Authorization Management
// ==========================================

// Create Doctor
app.post('/api/admin/create-doctor', requireAuth(['admin']), (req, res) => {
    const { firstname, lastname, specialization, phone, availability, password, username, email } = req.body;
    if (!firstname || !lastname || !specialization || !phone || !availability || !password || !username || !email) {
        return res.status(400).json({ error: 'All parameters must be fully registered.' });
    }
    try {
        const existing = db.prepare('SELECT D_ID FROM DOCTOR WHERE DOCTOR_USERNAME = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: `Doctor username "${username}" is already taken.` });
        }
        const stmt = db.prepare(`
            INSERT INTO DOCTOR (DOCTOR_FIRSTNAME, DOCTOR_LASTNAME, DOCTOR_SPECIALIZATION, DOCTOR_AVAILABILITY, DOCTOR_PHNO, DOCTOR_PASSWORD, DOCTOR_USERNAME, DOCTOR_EMAIL)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(firstname, lastname, specialization, availability, phone, hashPassword(password), username, email);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to create doctor:', err);
        res.status(500).json({ error: 'Failed to register doctor record.' });
    }
});

// Admin Route: View all pending staff override tickets
app.get('/api/admin/pending-resets', requireAuth(['admin']), (req, res) => {
    try {
        const requests = db.prepare("SELECT * FROM OTP_TOKENS WHERE ROLE IN ('doctor', 'receptionist')").all();
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tracking tickets.' });
    }
});

// Admin Route: Resolve / Approve a staff reset operation
app.post('/api/admin/approve-reset', requireAuth(['admin']), (req, res) => {
    const { ticketId, approvedPassword } = req.body;
    try {
        const ticket = db.prepare('SELECT * FROM OTP_TOKENS WHERE ID = ?').get(ticketId);
        if (!ticket) return res.status(404).json({ error: 'Request ticket matching identification vector not found.' });

        const hashedPass = hashPassword(approvedPassword);
        if (ticket.ROLE === 'doctor') {
            db.prepare('UPDATE DOCTOR SET DOCTOR_PASSWORD = ? WHERE DOCTOR_USERNAME = ?').run(hashedPass, ticket.USERNAME);
        } else if (ticket.ROLE === 'receptionist') {
            db.prepare('UPDATE RECEPTIONIST SET RECEP_PASSWORD = ? WHERE RECEP_USERNAME = ?').run(hashedPass, ticket.USERNAME);
        }
        
        db.prepare('DELETE FROM OTP_TOKENS WHERE ID = ?').run(ticketId);
        res.json({ success: true, message: `Successfully updated password profiles for staff account: ${ticket.USERNAME}` });
    } catch (err) {
        res.status(500).json({ error: 'Admin override resolution pipeline collapsed.' });
    }
});

app.delete('/api/admin/delete-doctor/:id', requireAuth(['admin']), (req, res) => {
    const doctorId = req.params.id;
    try {
        const executeDelete = db.transaction((id) => {
            db.prepare('DELETE FROM PRESCRIPTION WHERE DOCTOR_ID = ?').run(id);
            db.prepare('DELETE FROM BILLS WHERE APPOINTMENT_ID IN (SELECT AID FROM APPOINTMENT WHERE DOCTOR_ID = ?)').run(id);
            db.prepare('DELETE FROM APPOINTMENT WHERE DOCTOR_ID = ?').run(id);
            return db.prepare('DELETE FROM DOCTOR WHERE D_ID = ?').run(id);
        });
        const result = executeDelete(doctorId);
        if (result.changes === 0) return res.status(404).json({ error: 'Doctor not found.' });
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Failed to delete doctor:', err);
        res.status(500).json({ error: 'Failed to delete doctor record.' });
    }
});

// Verify Admin Login
app.post('/api/admin/verify-admin-login', (req, res) => {
    const { username, password } = req.body;
    try {
        const hashed = hashPassword(password);
        const admin = db.prepare('SELECT ID FROM ADMIN WHERE USERNAME = ? AND PASSWORD = ?').get(username, hashed);
        if (admin) {
            const sessionId = crypto.randomBytes(32).toString('hex');
            db.prepare('INSERT INTO SESSIONS (SESSION_ID, USERNAME, ROLE, EXPIRY) VALUES (?, ?, ?, ?)')
              .run(sessionId, username, 'admin', Date.now() + 2 * 60 * 60 * 1000);
            
            res.cookie('hms_session', sessionId, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 2 * 60 * 60 * 1000 });
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid admin credentials.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

// Verify Doctor Login
app.post('/api/admin/verify-doctor-login', (req, res) => {
    const { username, password } = req.body;
    try {
        const hashed = hashPassword(password);
        const doctor = db.prepare('SELECT D_ID, DOCTOR_FIRSTNAME, DOCTOR_LASTNAME FROM DOCTOR WHERE DOCTOR_USERNAME = ? AND DOCTOR_PASSWORD = ?').get(username, hashed);
        if (doctor) {
            const sessionId = crypto.randomBytes(32).toString('hex');
            db.prepare('INSERT INTO SESSIONS (SESSION_ID, USERNAME, ROLE, EXPIRY) VALUES (?, ?, ?, ?)')
              .run(sessionId, username, 'doctor', Date.now() + 2 * 60 * 60 * 1000);
            
            res.cookie('hms_session', sessionId, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 2 * 60 * 60 * 1000 });
            res.json({ success: true, doctor });
        } else {
            res.status(401).json({ error: 'Invalid staff username or password credentials.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Login verification failed.' });
    }
});

// Verify Receptionist Login
app.post('/api/admin/verify-receptionist-login', (req, res) => {
    const { username, password } = req.body;
    try {
        const hashed = hashPassword(password);
        const recep = db.prepare('SELECT RID, RECEP_NAME FROM RECEPTIONIST WHERE RECEP_USERNAME = ? AND RECEP_PASSWORD = ?').get(username, hashed);
        if (recep) {
            const sessionId = crypto.randomBytes(32).toString('hex');
            db.prepare('INSERT INTO SESSIONS (SESSION_ID, USERNAME, ROLE, EXPIRY) VALUES (?, ?, ?, ?)')
              .run(sessionId, username, 'receptionist', Date.now() + 2 * 60 * 60 * 1000);
            
            res.cookie('hms_session', sessionId, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 2 * 60 * 60 * 1000 });
            res.json({ success: true, name: recep.RECEP_NAME });
        } else {
            res.status(401).json({ error: 'Invalid receptionist username or password.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

// Verify Patient Login
app.post('/api/verify-patient-login', (req, res) => {
    const { username, password } = req.body;
    try {
        const hashed = hashPassword(password);
        const patient = db.prepare('SELECT PID, PATIENT_FIRSTNAME, PATIENT_LASTNAME FROM PATIENT WHERE PATIENT_USERNAME = ? AND PATIENT_PASSWORD = ?').get(username, hashed);
        if (patient) {
            const sessionId = crypto.randomBytes(32).toString('hex');
            db.prepare('INSERT INTO SESSIONS (SESSION_ID, USERNAME, ROLE, EXPIRY) VALUES (?, ?, ?, ?)')
              .run(sessionId, username, 'patient', Date.now() + 2 * 60 * 60 * 1000);
            
            res.cookie('hms_session', sessionId, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 2 * 60 * 60 * 1000 });
            res.json({ success: true, patient });
        } else {
            res.status(401).json({ error: 'Invalid username or password.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Login verification failed.' });
    }
});

// Logout API
app.post('/api/auth/logout', (req, res) => {
    const sessionId = getSessionFromCookie(req);
    if (sessionId) {
        try {
            db.prepare('DELETE FROM SESSIONS WHERE SESSION_ID = ?').run(sessionId);
        } catch (err) {}
    }
    res.clearCookie('hms_session');
    res.json({ success: true });
});

// ==========================================
// 8. AUTH API ROUTES (Forgot/Reset Password)
// ==========================================
app.post('/api/auth/forgot-password', async (req, res) => {
    const { role, identifier } = req.body;
    try {
        let user = null;
        let queryRole = role.toLowerCase();
        
        if (queryRole === 'doctor') {
            user = db.prepare('SELECT DOCTOR_USERNAME as username, DOCTOR_EMAIL as email FROM DOCTOR WHERE DOCTOR_USERNAME = ? OR DOCTOR_EMAIL = ?').get(identifier, identifier);
        } else if (queryRole === 'patient') {
            user = db.prepare('SELECT PATIENT_USERNAME as username, PATIENT_EMAIL as email FROM PATIENT WHERE PATIENT_USERNAME = ? OR PATIENT_EMAIL = ?').get(identifier, identifier);
        } else if (queryRole === 'receptionist') {
            user = db.prepare('SELECT RECEP_USERNAME as username, RECEP_EMAIL as email FROM RECEPTIONIST WHERE RECEP_USERNAME = ? OR RECEP_EMAIL = ?').get(identifier, identifier);
        }

        if (!user) {
            return res.status(404).json({ error: 'No matching user identity locked down inside this system configuration.' });
        }

        if (queryRole === 'doctor' || queryRole === 'receptionist') {
            // Staff route path: log a structural ticket request directly inside the admin lookup console table.
            db.prepare('INSERT INTO OTP_TOKENS (ROLE, USERNAME, OTP_CODE, EXPIRY) VALUES (?, ?, ?, ?)')
              .run(queryRole, user.username, 'PENDING_ADMIN_APPROVAL', Date.now() + (24 * 60 * 60 * 1000));
            
            return res.json({ success: true, username: user.username, message: 'Staff security ticket created successfully. Please reach out to your primary Admin manager to authorize your credentials update profile.' });
        }

        // Patient Pathway: Cryptographically secure verification hash link calculation sequence
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const expiry = Date.now() + 15 * 60 * 1000; // 15 mins validity window

        db.prepare('INSERT INTO OTP_TOKENS (ROLE, USERNAME, OTP_CODE, EXPIRY) VALUES (?, ?, ?, ?)').run(queryRole, user.username, verificationToken, expiry);

        const resetLink = `http://localhost:3000/reset-password.html?token=${verificationToken}&username=${user.username}`;
        const resetEmailHTML = `
        <!DOCTYPE html><html><body style="font-family:'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:40px 20px;">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
            <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:36px 40px;text-align:center;">
                <div style="font-size:44px;margin-bottom:10px;">🏥</div>
                <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;">HMS Hospital</h1>
                <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Password Reset Request</p>
            </div>
            <div style="padding:40px;">
                <h2 style="color:#0f172a;font-size:20px;margin:0 0 12px;">Reset Your Password</h2>
                <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 28px;">Hi <strong>${user.username}</strong>, we received a request to reset your password. Click the button below — this link expires in <strong>15 minutes</strong>.</p>
                <div style="text-align:center;margin:30px 0;">
                    <a href="${resetLink}" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;display:inline-block;">Reset My Password</a>
                </div>
                <p style="color:#94a3b8;font-size:12px;text-align:center;margin:24px 0 0;">If you didn't request this, you can safely ignore this email.<br>This link expires at ${new Date(expiry).toLocaleTimeString()}.</p>
            </div>
            <div style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
                <p style="color:#94a3b8;font-size:12px;margin:0;">© HMS Hospital Management System &bull; support@hms.org</p>
            </div>
        </div>
        </body></html>`;

        await sendHospitalEmail({
            to: user.email,
            subject: '🔐 HMS Password Reset Link',
            html: resetEmailHTML
        });

        console.log(`\n📧 Password reset email dispatched to: ${user.email}`);
        console.log(`🔗 Reset Link: ${resetLink}\n`);

        res.json({ success: true, username: user.username, message: `An authorization reset trace matrix link has been channeled down your registered mail server route at ${user.email}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Request processing engine fault dropped.' });
    }
});

app.post('/api/auth/reset-password', (req, res) => {
    const { username, otp, newPassword } = req.body; // otp here maps directly to our strict string payload verification hashes
    try {
        const validOtp = db.prepare('SELECT ID FROM OTP_TOKENS WHERE ROLE = \'patient\' AND USERNAME = ? AND OTP_CODE = ? AND EXPIRY > ?')
            .get(username, otp, Date.now());

        if (!validOtp) {
            return res.status(400).json({ error: 'The email verification code signature mismatch or has passed expiration boundaries.' });
        }

        db.prepare('UPDATE PATIENT SET PATIENT_PASSWORD = ? WHERE PATIENT_USERNAME = ?').run(hashPassword(newPassword), username);
        db.prepare('DELETE FROM OTP_TOKENS WHERE ID = ?').run(validOtp.ID);

        res.json({ success: true, message: 'Password profile synchronized securely. You may proceed to verification systems.' });
    } catch (err) {
        res.status(500).json({ error: 'Security structural adjustment engine fault.' });
    }
});

// ==========================================
// 7. ADMINISTRATIVE DATABASE RE-ENGINEERING WORKSPACE
// ==========================================
function ensureReceptionistTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS RECEPTIONIST (
            RID           INTEGER PRIMARY KEY AUTOINCREMENT,
            RECEP_NAME     TEXT NOT NULL,
            RECEP_USERNAME TEXT NOT NULL UNIQUE,
            RECEP_PASSWORD TEXT NOT NULL,
            RECEP_PHNO     TEXT,
            RECEP_EMAIL    TEXT
        )
    `).run();
}

function ensureDatabaseMigrations() {
    try {
        ensureReceptionistTable();
        
        db.prepare(`
            CREATE TABLE IF NOT EXISTS OTP_TOKENS (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                ROLE TEXT NOT NULL,
                USERNAME TEXT NOT NULL,
                OTP_CODE TEXT NOT NULL,
                EXPIRY INTEGER NOT NULL
            )
        `).run();

        // Create ADMIN table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS ADMIN (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                USERNAME TEXT NOT NULL UNIQUE,
                PASSWORD TEXT NOT NULL
            )
        `).run();

        // Seed default admin if table is empty
        const adminExists = db.prepare('SELECT ID FROM ADMIN WHERE USERNAME = ?').get('admin');
        if (!adminExists) {
            db.prepare('INSERT INTO ADMIN (USERNAME, PASSWORD) VALUES (?, ?)')
              .run('admin', hashPassword('admin@hms2024'));
            console.log("👤 Default Administrator seeded successfully.");
        }

        // Create SESSIONS table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS SESSIONS (
                SESSION_ID TEXT PRIMARY KEY,
                USERNAME TEXT NOT NULL,
                ROLE TEXT NOT NULL,
                EXPIRY INTEGER NOT NULL
            )
        `).run();

        console.log("🔒 Security and cryptography migrations completed successfully.");
    } catch (err) {
        console.error("Migration error:", err);
    }
}
ensureDatabaseMigrations();

// ==========================================
// 9. PAYMENT API ROUTES (Direct Settle)
// ==========================================
app.post('/api/bills/:id/mark-paid', requireAuth(['receptionist', 'admin']), (req, res) => {
    const billId = req.params.id;
    const { paymentMethod } = req.body;
    try {
        const method = paymentMethod || 'CASH';
        const result = db.prepare("UPDATE BILLS SET PAYMENT_STATUS = 'PAID', PAYMENT_METHOD = ? WHERE BILL_ID = ?").run(method, billId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Invoice record not found.' });
        }
        res.json({ success: true, message: `Bill INV-${billId} marked as PAID via ${method}.` });
    } catch (err) {
        console.error('Settle bill database error:', err);
        res.status(500).json({ error: 'Failed to settle invoice.' });
    }
});

// Send Prescription + Invoice Email to Patient after payment
app.post('/api/bills/:id/send-prescription-email', requireAuth(['receptionist', 'admin', 'patient']), async (req, res) => {
    const billId = req.params.id;
    try {
        const data = db.prepare(`
            SELECT b.*,
                   p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME, p.PATIENT_EMAIL, p.PATIENT_PHNO, p.PATIENT_DOB, p.PATIENT_BLOODGROUP, p.PATIENT_ADDRESS,
                   d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION,
                   a.APPOINTMENT_DATE, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE,
                   pr.SYMPTOMS as PRESCRIPTION_SYMPTOMS, pr.MEDICINE_NAME, pr.MEDICINE_DOSAGE, pr.MEDICINE_FREQUENCY, pr.MEDICINE_DURATION
            FROM BILLS b
            JOIN PATIENT p ON b.PATIENT_ID = p.PID
            JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
            JOIN DOCTOR d ON a.DOCTOR_ID = d.D_ID
            LEFT JOIN PRESCRIPTION pr ON a.AID = pr.APPOINTMENT_ID
            WHERE b.BILL_ID = ?
        `).get(billId);

        if (!data) return res.status(404).json({ error: 'Bill not found.' });
        if (!data.PATIENT_EMAIL) return res.status(400).json({ error: 'Patient has no registered email address.' });

        // Build medicines table rows
        let medicinesRows = '';
        try {
            const meds = JSON.parse(data.MEDICINE_NAME);
            if (Array.isArray(meds)) {
                meds.forEach(m => {
                    medicinesRows += `<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${m.name}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${m.dosage}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${m.frequency}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${m.duration}</td></tr>`;
                });
            } else throw new Error();
        } catch(e) {
            if (data.MEDICINE_NAME) {
                medicinesRows = `<tr><td style="padding:10px 12px;">${data.MEDICINE_NAME}</td><td>${data.MEDICINE_DOSAGE||'-'}</td><td>${data.MEDICINE_FREQUENCY||'-'}</td><td>${data.MEDICINE_DURATION||'-'}</td></tr>`;
            } else {
                medicinesRows = `<tr><td colspan="4" style="padding:10px 12px;color:#94a3b8;">No medication prescribed.</td></tr>`;
            }
        }

        const formattedDate = new Date(data.BILL_DATE).toLocaleDateString('en-IN', { year:'numeric', month:'long', day:'numeric' });

        const emailHTML = `
        <!DOCTYPE html><html><body style="font-family:'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:40px 20px;">
        <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
            <div style="background:linear-gradient(135deg,#064e3b,#065f46);padding:36px 40px;text-align:center;">
                <div style="font-size:44px;margin-bottom:10px;">🏥</div>
                <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">HMS Hospital</h1>
                <p style="color:#6ee7b7;margin:6px 0 0;font-size:13px;">Prescription &amp; Invoice Summary</p>
            </div>
            <div style="padding:36px 40px;">
                <p style="color:#0f172a;font-size:15px;margin:0 0 4px;">Dear <strong>${data.PATIENT_FIRSTNAME} ${data.PATIENT_LASTNAME}</strong>,</p>
                <p style="color:#475569;font-size:13px;margin:0 0 28px;">Thank you for visiting HMS Hospital. Here is your prescription and invoice summary for your visit on <strong>${data.APPOINTMENT_DATE}</strong>.</p>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
                    <p style="margin:0 0 6px;font-size:12px;color:#065f46;font-weight:700;text-transform:uppercase;">Treating Physician</p>
                    <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">Dr. ${data.DOCTOR_FIRSTNAME} ${data.DOCTOR_LASTNAME}</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#475569;">${data.DOCTOR_SPECIALIZATION} &bull; ${data.APPOINTMENT_VISIT_TYPE} Visit</p>
                </div>

                ${data.PRESCRIPTION_SYMPTOMS ? `
                <div style="margin-bottom:24px;">
                    <p style="margin:0 0 8px;font-size:12px;color:#475569;font-weight:700;text-transform:uppercase;">Diagnosis / Symptoms</p>
                    <p style="margin:0;font-size:14px;color:#0f172a;background:#f8fafc;padding:12px 16px;border-radius:8px;border:1px solid #e2e8f0;">${data.PRESCRIPTION_SYMPTOMS}</p>
                </div>` : ''}

                <div style="margin-bottom:28px;">
                    <p style="margin:0 0 10px;font-size:12px;color:#475569;font-weight:700;text-transform:uppercase;">Prescribed Medications (Rx)</p>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead><tr style="background:#10b981;color:#fff;">
                            <th style="padding:10px 12px;text-align:left;border-radius:6px 0 0 0;">Medicine</th>
                            <th style="padding:10px 12px;text-align:left;">Dosage</th>
                            <th style="padding:10px 12px;text-align:left;">Frequency</th>
                            <th style="padding:10px 12px;text-align:left;border-radius:0 6px 0 0;">Duration</th>
                        </tr></thead>
                        <tbody style="color:#0f172a;">${medicinesRows}</tbody>
                    </table>
                </div>

                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
                    <p style="margin:0 0 12px;font-size:12px;color:#475569;font-weight:700;text-transform:uppercase;">Invoice Summary — INV-${String(data.BILL_ID).padStart(4,'0')}</p>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#475569;font-size:13px;">Consultation Fee</span><span style="font-weight:600;font-size:13px;">₹${(data.CONSULTATION_CHARGES||0).toFixed(2)}</span></div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#475569;font-size:13px;">Lab &amp; Diagnostics</span><span style="font-weight:600;font-size:13px;">₹${(data.LAB_CHARGES||0).toFixed(2)}</span></div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#475569;font-size:13px;">Medicine Charges</span><span style="font-weight:600;font-size:13px;">₹${(data.MEDICINE_CHARGES||0).toFixed(2)}</span></div>
                    <div style="display:flex;justify-content:space-between;padding:10px 0 0;"><span style="font-weight:700;font-size:15px;color:#0f172a;">Total Amount</span><span style="font-weight:800;font-size:16px;color:#10b981;">₹${(data.TOTAL_AMOUNT||0).toFixed(2)}</span></div>
                    <p style="margin:10px 0 0;font-size:12px;color:#64748b;">Payment: ${data.PAYMENT_METHOD} &bull; Status: <span style="color:#10b981;font-weight:700;">${data.PAYMENT_STATUS}</span> &bull; Date: ${formattedDate}</p>
                </div>

                <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0;">Please keep this for your records. Get well soon! 💚</p>
            </div>
            <div style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
                <p style="color:#94a3b8;font-size:12px;margin:0;">© HMS Hospital Management System &bull; 123 Healthcare Boulevard &bull; support@hms.org</p>
            </div>
        </div>
        </body></html>`;

        await sendHospitalEmail({
            to: data.PATIENT_EMAIL,
            subject: `🏥 HMS — Prescription & Invoice INV-${String(data.BILL_ID).padStart(4,'0')}`,
            html: emailHTML
        });

        res.json({ success: true, message: `Prescription and invoice emailed to ${data.PATIENT_EMAIL}` });
    } catch (err) {
        console.error('Send prescription email error:', err);
        res.status(500).json({ error: 'Failed to send prescription email.' });
    }
});

// ==========================================
// 10. PATIENT, BILLING, INVOICE AND PRESCRIPTION EXTRA ROUTES
// ==========================================
app.get('/api/patient-dashboard/:id', requireAuth(['patient', 'doctor', 'receptionist', 'admin']), (req, res) => {
    const patientId = req.params.id;
    if (req.user.ROLE === 'patient') {
        const patient = db.prepare('SELECT PATIENT_USERNAME FROM PATIENT WHERE PID = ?').get(patientId);
        if (!patient || patient.PATIENT_USERNAME !== req.user.USERNAME) {
            return res.status(403).json({ error: 'Forbidden. You can only access your own profile.' });
        }
    }
    try {
        const patient = db.prepare('SELECT PID, PATIENT_FIRSTNAME, PATIENT_LASTNAME, PATIENT_DOB, PATIENT_GENDER, PATIENT_BLOODGROUP, PATIENT_ADDRESS, PATIENT_PHNO, PATIENT_EMAIL FROM PATIENT WHERE PID = ?').get(patientId);
        if (!patient) return res.status(404).json({ error: 'Patient not found.' });
        
        const appointments = db.prepare(`
            SELECT a.AID, a.APPOINTMENT_DATE, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE, a.APPOINTMENT_STATUS,
                   d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION
            FROM APPOINTMENT a
            JOIN DOCTOR d ON a.DOCTOR_ID = d.D_ID
            WHERE a.PATIENT_ID = ?
            ORDER BY a.AID DESC
        `).all(patientId);

        const prescriptions = db.prepare(`
            SELECT p.*, d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION, a.APPOINTMENT_DATE
            FROM PRESCRIPTION p
            JOIN DOCTOR d ON p.DOCTOR_ID = d.D_ID
            JOIN APPOINTMENT a ON p.APPOINTMENT_ID = a.AID
            WHERE p.PATIENT_ID = ?
            ORDER BY p.PRESCRIPTION_ID DESC
        `).all(patientId);

        const bills = db.prepare('SELECT * FROM BILLS WHERE PATIENT_ID = ? ORDER BY BILL_ID DESC').all(patientId);

        res.json({ patient, appointments, prescriptions, bills });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve patient dashboard details.' });
    }
});

app.get('/api/bill-invoice-details/:id', requireAuth(['patient', 'doctor', 'receptionist', 'admin']), (req, res) => {
    const billId = req.params.id;
    try {
        const data = db.prepare(`
            SELECT b.*,
                   p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME, p.PATIENT_PHNO, p.PATIENT_DOB, p.PATIENT_BLOODGROUP, p.PATIENT_ADDRESS, p.PATIENT_USERNAME,
                   d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION,
                   a.APPOINTMENT_DATE, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE,
                   pr.SYMPTOMS as PRESCRIPTION_SYMPTOMS, pr.MEDICINE_NAME, pr.MEDICINE_DOSAGE, pr.MEDICINE_FREQUENCY, pr.MEDICINE_DURATION
            FROM BILLS b
            JOIN PATIENT p ON b.PATIENT_ID = p.PID
            JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
            JOIN DOCTOR d ON a.DOCTOR_ID = d.D_ID
            LEFT JOIN PRESCRIPTION pr ON a.AID = pr.APPOINTMENT_ID
            WHERE b.BILL_ID = ?
        `).get(billId);
        
        if (!data) return res.status(404).json({ error: 'Bill not found.' });
        
        if (req.user.ROLE === 'patient' && data.PATIENT_USERNAME !== req.user.USERNAME) {
            return res.status(403).json({ error: 'Forbidden. You can only view your own bills.' });
        }
        
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve invoice details.' });
    }
});

app.get('/api/prescription-by-appointment/:id', requireAuth(['doctor', 'receptionist', 'admin', 'patient']), (req, res) => {
    const apptId = req.params.id;
    try {
        const p = db.prepare(`
            SELECT pr.*, d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION, pa.PATIENT_USERNAME
            FROM PRESCRIPTION pr
            JOIN DOCTOR d ON pr.DOCTOR_ID = d.D_ID
            JOIN PATIENT pa ON pr.PATIENT_ID = pa.PID
            WHERE pr.APPOINTMENT_ID = ?
        `).get(apptId);
        
        if (!p) return res.json(null);
        
        if (req.user.ROLE === 'patient' && p.PATIENT_USERNAME !== req.user.USERNAME) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve prescription.' });
    }
});

// ==========================================
// 11. STAFF RECEPTIONIST ACCOUNT MANAGEMENT (Admin Protected)
// ==========================================
app.get('/api/admin/receptionists', requireAuth(['admin']), (req, res) => {
    try {
        const list = db.prepare('SELECT RID, RECEP_NAME, RECEP_USERNAME, RECEP_PHNO, RECEP_EMAIL FROM RECEPTIONIST').all();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch receptionist list.' });
    }
});

app.post('/api/admin/create-receptionist', requireAuth(['admin']), (req, res) => {
    const { name, username, password, phone, email } = req.body;
    if (!name || !username || !password) {
        return res.status(400).json({ error: 'All parameters (name, username, password) must be provided.' });
    }
    try {
        const existing = db.prepare('SELECT RID FROM RECEPTIONIST WHERE RECEP_USERNAME = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: `Receptionist username "${username}" is already taken.` });
        }
        const stmt = db.prepare(`
            INSERT INTO RECEPTIONIST (RECEP_NAME, RECEP_USERNAME, RECEP_PASSWORD, RECEP_PHNO, RECEP_EMAIL)
            VALUES (?, ?, ?, ?, ?)
        `);
        const info = stmt.run(name, username, hashPassword(password), phone || '', email || '');
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create receptionist.' });
    }
});

app.delete('/api/admin/delete-receptionist/:id', requireAuth(['admin']), (req, res) => {
    const rid = req.params.id;
    try {
        const info = db.prepare('DELETE FROM RECEPTIONIST WHERE RID = ?').run(rid);
        if (info.changes === 0) return res.status(404).json({ error: 'Receptionist not found.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete receptionist.' });
    }
});

// ==========================================
// 12. PASSWORD MODIFICATIONS
// ==========================================
app.post('/api/doctor/change-password', requireAuth(['doctor']), (req, res) => {
    const { doctorId, oldPassword, newPassword } = req.body;
    try {
        const doctor = db.prepare('SELECT DOCTOR_PASSWORD, DOCTOR_USERNAME FROM DOCTOR WHERE D_ID = ?').get(doctorId);
        if (!doctor || doctor.DOCTOR_USERNAME !== req.user.USERNAME) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        if (doctor.DOCTOR_PASSWORD !== hashPassword(oldPassword)) {
            return res.status(400).json({ error: 'Invalid current password.' });
        }
        db.prepare('UPDATE DOCTOR SET DOCTOR_PASSWORD = ? WHERE D_ID = ?').run(hashPassword(newPassword), doctorId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password.' });
    }
});

app.post('/api/patient/change-password', requireAuth(['patient']), (req, res) => {
    const { patientId, oldPassword, newPassword } = req.body;
    try {
        const patient = db.prepare('SELECT PATIENT_PASSWORD, PATIENT_USERNAME FROM PATIENT WHERE PID = ?').get(patientId);
        if (!patient || patient.PATIENT_USERNAME !== req.user.USERNAME) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        if (patient.PATIENT_PASSWORD !== hashPassword(oldPassword)) {
            return res.status(400).json({ error: 'Invalid current password.' });
        }
        db.prepare('UPDATE PATIENT SET PATIENT_PASSWORD = ? WHERE PID = ?').run(hashPassword(newPassword), patientId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password.' });
    }
});

app.post('/api/receptionist/change-password', requireAuth(['receptionist']), (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const receptionist = db.prepare('SELECT RECEP_PASSWORD FROM RECEPTIONIST WHERE RECEP_USERNAME = ?').get(req.user.USERNAME);
        if (!receptionist) return res.status(404).json({ error: 'Receptionist profile not found.' });
        
        if (receptionist.RECEP_PASSWORD !== hashPassword(oldPassword)) {
            return res.status(400).json({ error: 'Invalid current password.' });
        }
        db.prepare('UPDATE RECEPTIONIST SET RECEP_PASSWORD = ? WHERE RECEP_USERNAME = ?').run(hashPassword(newPassword), req.user.USERNAME);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password.' });
    }
});



app.use((req, res, next) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'index.html'));
        return;
    }
    next();
});

app.listen(PORT, () => {
    console.log(`\n🚀 Breach-hardened HMS Server Engine running online at: http://localhost:${PORT}`);
});