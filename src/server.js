const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

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
            INSERT INTO PRESCRIPTION (APPOINTMENT_ID, PATIENT_ID, DOCTOR_ID, DIAGNOSIS, SYMPTOMS, MEDICINE_NAME, DOSAGE, FREQUENCY, DURATION)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        insertPrescription.run(
            p.appointment_id, 
            p.patient_id, 
            p.doctor_id, 
            p.diagnosis, 
            p.symptoms, 
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