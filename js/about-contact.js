const contactForm = document.getElementById('contactForm');

if (contactForm) {
  contactForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const subject = encodeURIComponent('MIPL shipment inquiry');
    const body = encodeURIComponent([
      'Name: ' + form.fname.value,
      'Company: ' + form.company.value,
      'Email: ' + form.email.value,
      'Phone: ' + form.phone.value,
      'Service: ' + form.service.value,
      'Route: ' + form.lane.value,
      '',
      form.message.value
    ].join('\n'));
    window.location.href = 'mailto:milogisticsprotocol@gmail.com?subject=' + subject + '&body=' + body;
    document.getElementById('formSuccess').classList.add('show');
  });
}