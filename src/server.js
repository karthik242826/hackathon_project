const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const Database = require('better-sqlite3');
const axios = require('axios');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// ─── Third-Party Services Init ────────────────────────────────────
const FAST2SMS_KEY = process.env.FAST2SMS_KEY || '';
const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID     || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || ''
});

const app = express();
const PORT = process.env.PORT || 3000;

// Connect directly to your existing database file located inside the same folder
const db = new Database(path.join(__dirname, 'hms.db'), { verbose: console.log });

// Middleware configurations
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve all your front-end assets directly

// ==========================================
// 1. API ROUTE: READ PIPELINE (Dashboard View)
// ==========================================
app.get('/api/doctor-dashboard/:id', (req, res) => {
    const doctorId = req.params.id;

    try {
        // Query profile data out of your exact DOCTOR table column layout
        const doctorStatement = db.prepare('SELECT * FROM DOCTOR WHERE D_ID = ?');
        const doctor = doctorStatement.get(doctorId);

        if (!doctor) {
            return res.status(404).json({ error: 'Doctor record not located.' });
        }

        // SQL Relational JOIN linking your APPOINTMENT columns up with matching PATIENT data keys
        const appointmentStatement = db.prepare(`
            SELECT a.AID, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE, a.APPOINTMENT_STATUS, a.PATIENT_ID,
                   p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME
            FROM APPOINTMENT a
            JOIN PATIENT p ON a.PATIENT_ID = p.PID
            WHERE a.DOCTOR_ID = ?
            ORDER BY a.APPOINTMENT_TIME ASC
        `);
        const appointments = appointmentStatement.all(doctorId);

        // Return combined JSON data payloads to client browser context
        res.json({ doctor, appointments });
    } catch (err) {
        console.error('Database query structural exception:', err);
        res.status(500).json({ error: 'Internal server query pipeline failed.' });
    }
});

// ==========================================
// 2. API ROUTE: WRITE PIPELINE (Prescription Commit)
// ==========================================
app.post('/api/save-prescription', (req, res) => {
    const data = req.body;

    // Use an atomic transaction block to guarantee data integrity across both table states
    const executePrescriptionTx = db.transaction((p) => {
        // SQL Statement matching your finalized PRESCRIPTION table columns perfectly
        const insertPrescription = db.prepare(`
            INSERT INTO PRESCRIPTION (APPOINTMENT_ID, PATIENT_ID, DOCTOR_ID, SYMPTOMS, MEDICINE_NAME, MEDICINE_DOSAGE, MEDICINE_FREQUENCY, MEDICINE_DURATION)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const symptomsCombined = p.diagnosis ? `Diagnosis: ${p.diagnosis}. Symptoms: ${p.symptoms}` : p.symptoms;
        
        insertPrescription.run(
            p.appointment_id, 
            p.patient_id, 
            p.doctor_id, 
            symptomsCombined, 
            p.medicine_name, 
            p.dosage, 
            p.frequency, 
            p.duration
        );

        // Update the corresponding APPOINTMENT status column to reflect completion state
        const updateAppointmentStatus = db.prepare(`
            UPDATE APPOINTMENT 
            SET APPOINTMENT_STATUS = 'COMPLETED' 
            WHERE AID = ?
        `);
        updateAppointmentStatus.run(p.appointment_id);
    });

    try {
        executePrescriptionTx(data);
        res.sendStatus(200); // Send success header back to UI
    } catch (err) {
        console.error('Database transaction failure processing record write:', err);
        res.status(500).json({ error: 'Database transaction crashed or was dropped.' });
    }
});

// ==========================================
// 4. API ROUTES FOR PATIENTS, SCHEDULING, AND BILLING
// ==========================================

// Add Patient Route
app.post('/api/add-patient', (req, res) => {
    const { firstname, lastname, dob, gender, bloodgroup, address, phno, username, password, email } = req.body;
    if (!firstname || !lastname || !dob || !gender || !bloodgroup || !address || !phno || !username || !password) {
        return res.status(400).json({ error: 'All fields, including username and password, are required.' });
    }
    try {
        // Check for duplicate patient username
        const existing = db.prepare('SELECT PID FROM PATIENT WHERE PATIENT_USERNAME = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: `Patient username "${username}" is already taken. Choose a different one.` });
        }

        const stmt = db.prepare(`
            INSERT INTO PATIENT (PATIENT_FIRSTNAME, PATIENT_LASTNAME, PATIENT_DOB, PATIENT_GENDER, PATIENT_BLOODGROUP, PATIENT_ADDRESS, PATIENT_PHNO, PATIENT_USERNAME, PATIENT_PASSWORD, PATIENT_EMAIL)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(firstname, lastname, dob, gender, bloodgroup, address, phno, username, password, email || null);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to add patient:', err);
        res.status(500).json({ error: 'Failed to add patient record.' });
    }
});

// Get all Patients
app.get('/api/patients', (req, res) => {
    try {
        const patients = db.prepare('SELECT * FROM PATIENT').all();
        res.json(patients);
    } catch (err) {
        console.error('Failed to retrieve patients:', err);
        res.status(500).json({ error: 'Failed to retrieve patients.' });
    }
});

// Get all Doctors
app.get('/api/doctors', (req, res) => {
    try {
        const doctors = db.prepare('SELECT * FROM DOCTOR').all();
        res.json(doctors);
    } catch (err) {
        console.error('Failed to retrieve doctors:', err);
        res.status(500).json({ error: 'Failed to retrieve doctors.' });
    }
});

// Schedule a new Appointment
app.post('/api/add-appointment', (req, res) => {
    const { patient_id, doctor_id, appointment_date, appointment_time, appointment_visit_type } = req.body;
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

// Get all Appointments (with patient/doctor info joined)
app.get('/api/appointments', (req, res) => {
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

// Generate invoice
app.post('/api/add-bill', (req, res) => {
    const { patient_id, appointment_id, consultation_charges, lab_charges, medicine_charges, total_amount, payment_method, payment_status } = req.body;
    try {
        const stmt = db.prepare(`
            INSERT INTO BILLS (PATIENT_ID, APPOINTMENT_ID, BILL_DATE, CONSULTATION_CHARGES, LAB_CHARGES, MEDICINE_CHARGES, TOTAL_AMOUNT, PAYMENT_METHOD, PAYMENT_STATUS)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const billDate = Date.now();
        const info = stmt.run(patient_id, appointment_id, billDate, consultation_charges, lab_charges, medicine_charges, total_amount, payment_method, payment_status);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to generate invoice:', err);
        res.status(500).json({ error: 'Failed to generate invoice.' });
    }
});

// Get all Bills
app.get('/api/bills', (req, res) => {
    try {
        const bills = db.prepare(`
            SELECT b.*, 
                   p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME,
                   a.APPOINTMENT_DATE
            FROM BILLS b
            JOIN PATIENT p ON b.PATIENT_ID = p.PID
            JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
            ORDER BY b.BILL_ID DESC
        `).all();
        res.json(bills);
    } catch (err) {
        console.error('Failed to retrieve bills:', err);
        res.status(500).json({ error: 'Failed to retrieve bills.' });
    }
});

// Patient dashboard metadata fetch
app.get('/api/patient-dashboard/:id', (req, res) => {
    const patientId = req.params.id;
    try {
        const patient = db.prepare('SELECT * FROM PATIENT WHERE PID = ?').get(patientId);
        if (!patient) {
            return res.status(404).json({ error: 'Patient profile not found.' });
        }
        const appointments = db.prepare(`
            SELECT a.*, d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION
            FROM APPOINTMENT a
            JOIN DOCTOR d ON a.DOCTOR_ID = d.D_ID
            WHERE a.PATIENT_ID = ?
            ORDER BY a.APPOINTMENT_DATE DESC, a.APPOINTMENT_TIME DESC
        `).all(patientId);
        const prescriptions = db.prepare(`
            SELECT pr.*, d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION, a.APPOINTMENT_DATE
            FROM PRESCRIPTION pr
            JOIN DOCTOR d ON pr.DOCTOR_ID = d.D_ID
            JOIN APPOINTMENT a ON pr.APPOINTMENT_ID = a.AID
            WHERE pr.PATIENT_ID = ?
            ORDER BY pr.PRESCRIPTION_ID DESC
        `).all(patientId);
        const bills = db.prepare(`
            SELECT b.*, a.APPOINTMENT_DATE
            FROM BILLS b
            JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
            WHERE b.PATIENT_ID = ?
            ORDER BY b.BILL_ID DESC
        `).all(patientId);
        res.json({ patient, appointments, prescriptions, bills });
    } catch (err) {
        console.error('Failed to load patient dashboard:', err);
        res.status(500).json({ error: 'Failed to load patient portal data.' });
    }
});

// Fetch prescription details by appointment ID
app.get('/api/prescription-by-appointment/:apptId', (req, res) => {
    const apptId = req.params.apptId;
    try {
        const prescription = db.prepare(`
            SELECT pr.*, d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION
            FROM PRESCRIPTION pr
            JOIN DOCTOR d ON pr.DOCTOR_ID = d.D_ID
            WHERE pr.APPOINTMENT_ID = ?
        `).get(apptId);
        res.json(prescription || null);
    } catch (err) {
        console.error('Failed to fetch prescription:', err);
        res.status(500).json({ error: 'Failed to retrieve prescription.' });
    }
});

// Fetch detailed billing invoice metadata for PDF export
app.get('/api/bill-invoice-details/:billId', (req, res) => {
    const billId = req.params.billId;
    try {
        const billDetails = db.prepare(`
            SELECT b.*,
                   p.PATIENT_FIRSTNAME, p.PATIENT_LASTNAME, p.PATIENT_PHNO, p.PATIENT_DOB, p.PATIENT_BLOODGROUP, p.PATIENT_ADDRESS,
                   a.APPOINTMENT_DATE, a.APPOINTMENT_TIME, a.APPOINTMENT_VISIT_TYPE,
                   d.DOCTOR_FIRSTNAME, d.DOCTOR_LASTNAME, d.DOCTOR_SPECIALIZATION,
                   pr.SYMPTOMS as PRESCRIPTION_SYMPTOMS, pr.MEDICINE_NAME, pr.MEDICINE_DOSAGE, pr.MEDICINE_FREQUENCY, pr.MEDICINE_DURATION
            FROM BILLS b
            JOIN PATIENT p ON b.PATIENT_ID = p.PID
            JOIN APPOINTMENT a ON b.APPOINTMENT_ID = a.AID
            JOIN DOCTOR d ON a.DOCTOR_ID = d.D_ID
            LEFT JOIN PRESCRIPTION pr ON b.APPOINTMENT_ID = pr.APPOINTMENT_ID
            WHERE b.BILL_ID = ?
        `).get(billId);
        
        if (!billDetails) {
            return res.status(404).json({ error: 'Invoice not found.' });
        }
        res.json(billDetails);
    } catch (err) {
        console.error('Failed to retrieve invoice details:', err);
        res.status(500).json({ error: 'Failed to retrieve invoice details.' });
    }
});

// ==========================================
// 5. ADMIN API ROUTES — Doctor Management
// ==========================================

// Create a new Doctor (Admin only)
app.post('/api/admin/create-doctor', (req, res) => {
    const { firstname, lastname, specialization, phone, availability, password, username, email } = req.body;

    if (!firstname || !lastname || !specialization || !phone || !availability || !password || !username) {
        return res.status(400).json({ error: 'All fields, including username, are required to register a doctor.' });
    }

    try {
        // Check for duplicate doctor username
        const existing = db.prepare('SELECT D_ID FROM DOCTOR WHERE DOCTOR_USERNAME = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: `Doctor username "${username}" is already taken. Choose a different one.` });
        }

        const stmt = db.prepare(`
            INSERT INTO DOCTOR (DOCTOR_FIRSTNAME, DOCTOR_LASTNAME, DOCTOR_SPECIALIZATION, DOCTOR_AVAILABILITY, DOCTOR_PHNO, DOCTOR_PASSWORD, DOCTOR_USERNAME, DOCTOR_EMAIL)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(firstname, lastname, specialization, availability, phone, password, username, email || null);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to create doctor:', err);
        res.status(500).json({ error: 'Failed to register doctor record.' });
    }
});

// Delete a Doctor by ID (Admin only)
app.delete('/api/admin/delete-doctor/:id', (req, res) => {
    const doctorId = req.params.id;
    try {
        const executeDelete = db.transaction((id) => {
            db.prepare('DELETE FROM PRESCRIPTION WHERE DOCTOR_ID = ?').run(id);
            db.prepare('DELETE FROM BILLS WHERE APPOINTMENT_ID IN (SELECT AID FROM APPOINTMENT WHERE DOCTOR_ID = ?)').run(id);
            db.prepare('DELETE FROM APPOINTMENT WHERE DOCTOR_ID = ?').run(id);
            return db.prepare('DELETE FROM DOCTOR WHERE D_ID = ?').run(id);
        });
        
        const result = executeDelete(doctorId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Doctor not found.' });
        }
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Failed to delete doctor:', err);
        res.status(500).json({ error: 'Failed to delete doctor record.' });
    }
});

// Admin: Doctor login verification (for doctor-login page)
app.post('/api/admin/verify-doctor-login', (req, res) => {
    const { username, password } = req.body;
    try {
        // Support checking by doctor_username as well as doctor_id (fallback for backward compatibility)
        let doctor = db.prepare('SELECT * FROM DOCTOR WHERE DOCTOR_USERNAME = ? AND DOCTOR_PASSWORD = ?').get(username, password);
        if (!doctor) {
            // Fallback: check if they entered the ID as the username
            doctor = db.prepare('SELECT * FROM DOCTOR WHERE D_ID = ? AND DOCTOR_PASSWORD = ?').get(username, password);
        }
        if (!doctor && username === 'doctor' && password === 'doctor123') {
            // Hardcoded fallback if no record matched
            doctor = db.prepare('SELECT * FROM DOCTOR WHERE D_ID = 1').get();
        }

        if (doctor) {
            res.json({ success: true, doctor });
        } else {
            res.status(401).json({ error: 'Invalid username or password.' });
        }
    } catch (err) {
        console.error('Doctor login check failed:', err);
        res.status(500).json({ error: 'Login verification failed.' });
    }
});

// Verify Patient Login
app.post('/api/verify-patient-login', (req, res) => {
    const { username, password } = req.body;
    try {
        let patient = db.prepare('SELECT * FROM PATIENT WHERE PATIENT_USERNAME = ? AND PATIENT_PASSWORD = ?').get(username, password);
        if (!patient) {
            // Fallback to check by ID
            patient = db.prepare('SELECT * FROM PATIENT WHERE PID = ? AND PATIENT_PASSWORD = ?').get(username, password);
        }
        if (!patient && username === 'patient' && password === 'patient123') {
            // Legacy fallback
            patient = db.prepare('SELECT * FROM PATIENT WHERE PID = 1').get();
        }

        if (patient) {
            res.json({ success: true, patient });
        } else {
            res.status(401).json({ error: 'Invalid username or password.' });
        }
    } catch (err) {
        console.error('Patient login check failed:', err);
        res.status(500).json({ error: 'Login verification failed.' });
    }
});

// Change Doctor Password
app.post('/api/doctor/change-password', (req, res) => {
    const { doctorId, oldPassword, newPassword } = req.body;
    if (!doctorId || !oldPassword || !newPassword) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    try {
        const doctor = db.prepare('SELECT * FROM DOCTOR WHERE D_ID = ?').get(doctorId);
        if (!doctor || doctor.DOCTOR_PASSWORD !== oldPassword) {
            return res.status(401).json({ error: 'Incorrect old password.' });
        }
        db.prepare('UPDATE DOCTOR SET DOCTOR_PASSWORD = ? WHERE D_ID = ?').run(newPassword, doctorId);
        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
        console.error('Failed to change doctor password:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Change Patient Password
app.post('/api/patient/change-password', (req, res) => {
    const { patientId, oldPassword, newPassword } = req.body;
    if (!patientId || !oldPassword || !newPassword) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    try {
        const patient = db.prepare('SELECT * FROM PATIENT WHERE PID = ?').get(patientId);
        if (!patient || patient.PATIENT_PASSWORD !== oldPassword) {
            return res.status(401).json({ error: 'Incorrect old password.' });
        }
        db.prepare('UPDATE PATIENT SET PATIENT_PASSWORD = ? WHERE PID = ?').run(newPassword, patientId);
        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
        console.error('Failed to change patient password:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Change Receptionist Password
app.post('/api/receptionist/change-password', (req, res) => {
    const { recepUsername, oldPassword, newPassword } = req.body;
    if (!recepUsername || !oldPassword || !newPassword) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    try {
        // Support both DB receptionist records and legacy credentials
        let recep = db.prepare('SELECT * FROM RECEPTIONIST WHERE RECEP_USERNAME = ?').get(recepUsername);
        if (recep) {
            if (recep.RECEP_PASSWORD !== oldPassword) {
                return res.status(401).json({ error: 'Incorrect old password.' });
            }
            db.prepare('UPDATE RECEPTIONIST SET RECEP_PASSWORD = ? WHERE RECEP_USERNAME = ?').run(newPassword, recepUsername);
            return res.json({ success: true, message: 'Password updated successfully.' });
        }
        
        // Fallback for hardcoded account
        if (recepUsername === 'receptionist' && oldPassword === 'receptionist123') {
            db.prepare("INSERT INTO RECEPTIONIST (RECEP_NAME, RECEP_USERNAME, RECEP_PASSWORD, RECEP_PHNO) VALUES ('Receptionist', 'receptionist', ?, null)").run(newPassword);
            return res.json({ success: true, message: 'Password updated successfully (account migrated to database).' });
        }
        
        res.status(404).json({ error: 'Receptionist account not found or incorrect password.' });
    } catch (err) {
        console.error('Failed to change receptionist password:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ==========================================
// 6. ADMIN API ROUTES — Patient Management
// ==========================================

// Delete a Patient by ID (Admin only)
app.delete('/api/admin/delete-patient/:id', (req, res) => {
    const patientId = req.params.id;
    try {
        const executeDelete = db.transaction((id) => {
            db.prepare('DELETE FROM PRESCRIPTION WHERE PATIENT_ID = ?').run(id);
            db.prepare('DELETE FROM BILLS WHERE PATIENT_ID = ?').run(id);
            db.prepare('DELETE FROM APPOINTMENT WHERE PATIENT_ID = ?').run(id);
            return db.prepare('DELETE FROM PATIENT WHERE PID = ?').run(id);
        });
        
        const result = executeDelete(patientId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Patient not found.' });
        }
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Failed to delete patient:', err);
        res.status(500).json({ error: 'Failed to delete patient record.' });
    }
});

// ==========================================
// 7. ADMIN API ROUTES — Receptionist Management
// ==========================================

// Ensure RECEPTIONIST table exists (idempotent migration)
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
ensureReceptionistTable();

// Ensure database has necessary columns for usernames and passwords
function ensureDatabaseMigrations() {
    try {
        ensureReceptionistTable();
        
        // 1. DOCTOR table updates
        const docCols = db.prepare("PRAGMA table_info(DOCTOR)").all().map(c => c.name);
        if (!docCols.includes('DOCTOR_PASSWORD')) {
            db.prepare("ALTER TABLE DOCTOR ADD COLUMN DOCTOR_PASSWORD TEXT").run();
        }
        if (!docCols.includes('DOCTOR_USERNAME')) {
            db.prepare("ALTER TABLE DOCTOR ADD COLUMN DOCTOR_USERNAME TEXT").run();
            // Populate usernames for existing doctors: D_ID 1 gets 'doctor', others get doctor_<id>
            const doctors = db.prepare("SELECT D_ID FROM DOCTOR").all();
            for (const d of doctors) {
                const username = d.D_ID === 1 ? 'doctor' : `doctor_${d.D_ID}`;
                db.prepare("UPDATE DOCTOR SET DOCTOR_USERNAME = ? WHERE D_ID = ?").run(username, d.D_ID);
            }
        }
        if (!docCols.includes('DOCTOR_EMAIL')) {
            db.prepare("ALTER TABLE DOCTOR ADD COLUMN DOCTOR_EMAIL TEXT").run();
        }
        db.prepare("UPDATE DOCTOR SET DOCTOR_PASSWORD = 'doctor123' WHERE DOCTOR_PASSWORD IS NULL").run();

        // 2. PATIENT table updates
        const patCols = db.prepare("PRAGMA table_info(PATIENT)").all().map(c => c.name);
        if (!patCols.includes('PATIENT_USERNAME')) {
            db.prepare("ALTER TABLE PATIENT ADD COLUMN PATIENT_USERNAME TEXT").run();
            // Populate usernames: PID 1 gets 'patient', others get patient_<id>
            const patients = db.prepare("SELECT PID FROM PATIENT").all();
            for (const p of patients) {
                const username = p.PID === 1 ? 'patient' : `patient_${p.PID}`;
                db.prepare("UPDATE PATIENT SET PATIENT_USERNAME = ? WHERE PID = ?").run(username, p.PID);
            }
        }
        if (!patCols.includes('PATIENT_PASSWORD')) {
            db.prepare("ALTER TABLE PATIENT ADD COLUMN PATIENT_PASSWORD TEXT").run();
        }
        if (!patCols.includes('PATIENT_EMAIL')) {
            db.prepare("ALTER TABLE PATIENT ADD COLUMN PATIENT_EMAIL TEXT").run();
        }
        db.prepare("UPDATE PATIENT SET PATIENT_PASSWORD = 'patient123' WHERE PATIENT_PASSWORD IS NULL").run();

        // 3. RECEPTIONIST table updates (in case it existed before ensureReceptionistTable was updated)
        const recCols = db.prepare("PRAGMA table_info(RECEPTIONIST)").all().map(c => c.name);
        if (!recCols.includes('RECEP_EMAIL')) {
            db.prepare("ALTER TABLE RECEPTIONIST ADD COLUMN RECEP_EMAIL TEXT").run();
        }

        // 4. OTP Tokens Table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS OTP_TOKENS (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                ROLE TEXT NOT NULL,
                USERNAME TEXT NOT NULL,
                OTP_CODE TEXT NOT NULL,
                EXPIRY INTEGER NOT NULL
            )
        `).run();

        console.log("Database migrations completed successfully.");
    } catch (err) {
        console.error("Migration error:", err);
    }
}
ensureDatabaseMigrations();

// Get all Receptionists
app.get('/api/admin/receptionists', (req, res) => {
    try {
        ensureReceptionistTable();
        const list = db.prepare('SELECT RID, RECEP_NAME, RECEP_USERNAME, RECEP_PHNO FROM RECEPTIONIST ORDER BY RID DESC').all();
        res.json(list);
    } catch (err) {
        console.error('Failed to get receptionists:', err);
        res.status(500).json({ error: 'Failed to retrieve receptionists.' });
    }
});

// Create Receptionist
app.post('/api/admin/create-receptionist', (req, res) => {
    const { name, username, password, phone, email } = req.body;
    if (!name || !username || !password) {
        return res.status(400).json({ error: 'Name, username, and password are required.' });
    }
    try {
        ensureReceptionistTable();
        // Check for duplicate username
        const existing = db.prepare('SELECT RID FROM RECEPTIONIST WHERE RECEP_USERNAME = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: `Username "${username}" is already taken. Choose a different one.` });
        }
        const stmt = db.prepare(`
            INSERT INTO RECEPTIONIST (RECEP_NAME, RECEP_USERNAME, RECEP_PASSWORD, RECEP_PHNO, RECEP_EMAIL)
            VALUES (?, ?, ?, ?, ?)
        `);
        const info = stmt.run(name, username, password, phone || null, email || null);
        res.status(200).json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Failed to create receptionist:', err);
        res.status(500).json({ error: 'Failed to create receptionist account.' });
    }
});

// Delete Receptionist by ID
app.delete('/api/admin/delete-receptionist/:id', (req, res) => {
    const rid = req.params.id;
    try {
        ensureReceptionistTable();
        const result = db.prepare('DELETE FROM RECEPTIONIST WHERE RID = ?').run(rid);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Receptionist not found.' });
        }
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Failed to delete receptionist:', err);
        res.status(500).json({ error: 'Failed to delete receptionist account.' });
    }
});

// Verify Receptionist Login (used by receptionist-login page)
app.post('/api/admin/verify-receptionist-login', (req, res) => {
    const { username, password } = req.body;
    try {
        ensureReceptionistTable();
        // First check DB accounts
        const recep = db.prepare('SELECT * FROM RECEPTIONIST WHERE RECEP_USERNAME = ? AND RECEP_PASSWORD = ?').get(username, password);
        if (recep) {
            return res.json({ success: true, name: recep.RECEP_NAME });
        }
        // Fallback: legacy hardcoded account (receptionist / receptionist123)
        if (username === 'receptionist' && password === 'receptionist123') {
            return res.json({ success: true, name: 'Receptionist' });
        }
        res.status(401).json({ error: 'Invalid username or password.' });
    } catch (err) {
        console.error('Receptionist login check failed:', err);
        res.status(500).json({ error: 'Login verification failed.' });
    }
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
            user = db.prepare('SELECT D_ID as id, DOCTOR_USERNAME as username, DOCTOR_PHNO as phone, DOCTOR_EMAIL as email FROM DOCTOR WHERE DOCTOR_USERNAME = ? OR DOCTOR_PHNO = ?').get(identifier, identifier);
        } else if (queryRole === 'patient') {
            user = db.prepare('SELECT PID as id, PATIENT_USERNAME as username, PATIENT_PHNO as phone, PATIENT_EMAIL as email FROM PATIENT WHERE PATIENT_USERNAME = ? OR PATIENT_PHNO = ?').get(identifier, identifier);
        } else if (queryRole === 'receptionist') {
            user = db.prepare('SELECT RID as id, RECEP_USERNAME as username, RECEP_PHNO as phone, RECEP_EMAIL as email FROM RECEPTIONIST WHERE RECEP_USERNAME = ? OR RECEP_PHNO = ?').get(identifier, identifier);
        } else if (queryRole === 'admin') {
            if (identifier === 'admin') {
                user = { id: 1, username: 'admin', phone: '1234567890', email: 'admin@hms.com' };
            }
        }

        if (!user) {
            return res.status(404).json({ error: 'Account not found with that username or phone number.' });
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + 15 * 60 * 1000;

        db.prepare('INSERT INTO OTP_TOKENS (ROLE, USERNAME, OTP_CODE, EXPIRY) VALUES (?, ?, ?, ?)').run(queryRole, user.username, otpCode, expiry);

        console.log(`\n========================================`);
        console.log(`🔒 OTP GENERATED for ${queryRole} (${user.username})`);
        console.log(`🔑 Code: ${otpCode}`);
        console.log(`📱 Phone: ${user.phone || 'N/A'} | 📧 Email: ${user.email || 'N/A'}`);
        console.log(`========================================\n`);

        // ─── Fast2SMS: Send Real SMS (tries OTP route, falls back to Quick route) ──────
        let smsSent = false;
        let smsStatusMsg = '';
        if (FAST2SMS_KEY && FAST2SMS_KEY !== 'YOUR_FAST2SMS_API_KEY_HERE' && user.phone) {
            try {
                // Try OTP route first
                const otpRes = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
                    params: { authorization: FAST2SMS_KEY, variables_values: otpCode, route: 'otp', numbers: user.phone },
                    headers: { 'cache-control': 'no-cache' },
                    validateStatus: () => true, // don't throw on 4xx — read the body
                    timeout: 8000
                });

                if (otpRes.data && otpRes.data.return === true) {
                    smsSent = true;
                    console.log(`✅ SMS sent via OTP route to ${user.phone}`);
                } else {
                    // OTP route unavailable (needs verification/credit) → try Quick SMS route
                    console.warn(`⚠️ OTP route: ${otpRes.data ? otpRes.data.message : 'failed'} → trying Quick route...`);
                    const qRes = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
                        params: {
                            authorization: FAST2SMS_KEY,
                            message: `Your HMS security code is: ${otpCode}. Valid for 15 minutes. Do not share.`,
                            language: 'english',
                            route: 'q',
                            numbers: user.phone
                        },
                        headers: { 'cache-control': 'no-cache' },
                        validateStatus: () => true,
                        timeout: 8000
                    });
                    if (qRes.data && qRes.data.return === true) {
                        smsSent = true;
                        console.log(`✅ SMS sent via Quick route to ${user.phone}`);
                    } else {
                        smsStatusMsg = qRes.data ? qRes.data.message : 'Unknown error';
                        console.warn(`⚠️ Quick route also failed: ${smsStatusMsg}`);
                    }
                }
            } catch (smsErr) {
                console.error('⚠️ Fast2SMS network error:', smsErr.message);
            }
        }

        const message = smsSent
            ? `Security code sent via SMS to registered phone number.`
            : `Security code generated. Check server console (SMS not configured or unavailable).`;

        res.json({ success: true, message, mockCode: otpCode, username: user.username, smsSent });
    } catch (err) {
        console.error('Forgot password failed:', err);
        res.status(500).json({ error: 'Failed to process forgot password request.' });
    }
});

app.post('/api/auth/reset-password', (req, res) => {
    const { role, username, otp, newPassword } = req.body;
    try {
        let queryRole = role.toLowerCase();
        
        const validOtp = db.prepare('SELECT ID FROM OTP_TOKENS WHERE ROLE = ? AND USERNAME = ? AND OTP_CODE = ? AND EXPIRY > ? ORDER BY ID DESC LIMIT 1')
            .get(queryRole, username, otp, Date.now());

        if (!validOtp) {
            return res.status(400).json({ error: 'Invalid or expired security code.' });
        }

        if (queryRole === 'doctor') {
            db.prepare('UPDATE DOCTOR SET DOCTOR_PASSWORD = ? WHERE DOCTOR_USERNAME = ?').run(newPassword, username);
        } else if (queryRole === 'patient') {
            db.prepare('UPDATE PATIENT SET PATIENT_PASSWORD = ? WHERE PATIENT_USERNAME = ?').run(newPassword, username);
        } else if (queryRole === 'receptionist') {
            db.prepare('UPDATE RECEPTIONIST SET RECEP_PASSWORD = ? WHERE RECEP_USERNAME = ?').run(newPassword, username);
        } else if (queryRole === 'admin') {
            if (username !== 'admin') {
                return res.status(404).json({ error: 'Admin account not found.' });
            }
        }

        db.prepare('DELETE FROM OTP_TOKENS WHERE ID = ?').run(validOtp.ID);

        res.json({ success: true, message: 'Password reset successfully. You can now login.' });
    } catch (err) {
        console.error('Reset password failed:', err);
        res.status(500).json({ error: 'Failed to reset password.' });
    }
});

// ==========================================
// 9. PAYMENT API ROUTES (Razorpay UPI)
// ==========================================

// Create a Razorpay order for a bill
app.post('/api/payment/create-order', async (req, res) => {
    const { billId, amount, currency } = req.body;
    if (!billId || !amount) {
        return res.status(400).json({ error: 'billId and amount are required.' });
    }
    try {
        if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === 'YOUR_RAZORPAY_KEY_ID_HERE') {
            return res.status(503).json({ error: 'Razorpay is not configured. Please add your API keys to the .env file.' });
        }
        const order = await razorpay.orders.create({
            amount: Math.round(parseFloat(amount) * 100), // Convert ₹ to paise
            currency: currency || 'INR',
            receipt: `hms_bill_${billId}`,
            notes: { bill_id: billId }
        });
        res.json({ success: true, order, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (err) {
        console.error('Razorpay order creation failed:', err);
        res.status(500).json({ error: 'Failed to create payment order. Check Razorpay credentials.' });
    }
});

// Verify Razorpay payment signature and update bill status
app.post('/api/payment/verify', (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, billId } = req.body;
    try {
        const secret = process.env.RAZORPAY_KEY_SECRET || '';
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');

        if (expectedSig !== razorpay_signature) {
            return res.status(400).json({ error: 'Payment verification failed. Invalid signature.' });
        }

        // Mark bill as PAID
        const result = db.prepare(`
            UPDATE BILLS SET PAYMENT_STATUS = 'PAID', PAYMENT_METHOD = 'UPI' WHERE BILL_ID = ?
        `).run(billId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Bill not found.' });
        }

        console.log(`✅ Payment verified for Bill #${billId} | Payment ID: ${razorpay_payment_id}`);
        res.json({ success: true, message: 'Payment successful. Bill marked as PAID.', paymentId: razorpay_payment_id });
    } catch (err) {
        console.error('Payment verification failed:', err);
        res.status(500).json({ error: 'Failed to verify payment.' });
    }
});

// Get Razorpay config (key_id only — safe for frontend)
app.get('/api/payment/config', (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const configured = keyId && keyId !== 'YOUR_RAZORPAY_KEY_ID_HERE';
    res.json({ configured, keyId: configured ? keyId : null });
});

// ==========================================
// 3. EXPRESS V5 SAFE CATCH-ALL MIDDLEWARE
// ==========================================
// By removing the string path completely, we bypass the path-to-regexp parser entirely!
app.use((req, res, next) => {
    // If a request hits here and isn't looking for an API, send index.html
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'index.html'));
        return;
    }
    next();
});

app.listen(PORT, () => {
    console.log(`\n🚀 HMS Server Engine online and tracking database transactions at: http://localhost:${PORT}`);
});