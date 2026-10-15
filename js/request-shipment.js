const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx4LK14cbdDUWrHvPXVLI4QjLYGd6Mxth3Ch01GW7V7Fj_4EIONiW8EQS7JSaVALgV0/exec";
const shipmentForm = document.getElementById('shipmentForm');

if (shipmentForm) {
  shipmentForm.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) {
      document.getElementById('formError').classList.add('show');
      document.getElementById('formError').querySelector('span').textContent =
        "Booking system isn't connected yet — please email us directly at milogisticsprotocol@gmail.com.";
      return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    document.getElementById('formError').classList.remove('show');

    const payload = {
      reference: document.getElementById('sname').value + (document.getElementById('scompany').value ? ' / ' + document.getElementById('scompany').value : ''),
      serviceType: document.getElementById('sservice').value,
      originLabel: document.getElementById('sorigin').value,
      destination: document.getElementById('sdest').value,
      eta: document.getElementById('seta').value,
      description: document.getElementById('sdesc').value,
      unit: document.getElementById('sunit').value,
      note: [
        document.getElementById('snote').value,
        'Contact: ' + document.getElementById('semail').value + (document.getElementById('sphone').value ? ' / ' + document.getElementById('sphone').value : '')
      ].filter(Boolean).join(' — ')
    };

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(response => response.json())
      .then(data => {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        if (data.success) {
          document.getElementById('issuedId').textContent = data.trackingNumber;
          document.getElementById('trackNowLink').href = 'my-shipment.html?id=' + encodeURIComponent(data.trackingNumber);
          document.getElementById('formSuccess').classList.add('show');
          shipmentForm.querySelectorAll('input, select, textarea, button[type=submit]').forEach(element => {
            element.style.display = 'none';
          });
        } else {
          document.getElementById('formError').classList.add('show');
        }
      })
      .catch(() => {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        document.getElementById('formError').classList.add('show');
      });
  });
}