document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('patientRegisterForm');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const payload = {
            firstname: document.getElementById('firstname').value.trim(),
            lastname: document.getElementById('lastname').value.trim(),
            dob: document.getElementById('dob').value,
            gender: document.getElementById('gender').value,
            bloodgroup: document.getElementById('bloodgroup').value.trim(),
            phno: document.getElementById('phno').value.trim(),
            address: document.getElementById('address').value.trim(),
            username: document.getElementById('patient-username').value.trim(),
            password: document.getElementById('patient-password').value
        };
        
        try {
            const response = await fetch('/api/add-patient', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                alert(`Patient successfully registered! Patient ID is: ${result.id}`);
                form.reset();
                window.location.href = './receptionist.html';
            } else {
                alert(result.error || 'Failed to register patient in the database.');
            }
        } catch (error) {
            console.error('Error in patient intake pipeline:', error);
            alert('A network communication error occurred. Check server logs.');
        }
    });
});
