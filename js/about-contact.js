const contactForm = document.getElementById('contactForm');

if (contactForm) {
  contactForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const successMessage = document.getElementById('formSuccess');
    const errorMessage = document.getElementById('formError');
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    payload._replyto = formData.get('email');
    successMessage.classList.remove('show');
    errorMessage.hidden = true;
    submitButton.disabled = true;

    try {
      const response = await fetch('https://formsubmit.co/ajax/milogisticsprotocol@gmail.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (!response.ok || (result.success !== 'true' && result.success !== true)) {
        throw new Error(result.message || `Email service responded with status ${response.status}.`);
      }

      form.reset();
      successMessage.classList.add('show');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      errorMessage.textContent = `Your message was not sent. ${detail} Please try again or email milogisticsprotocol@gmail.com.`;
      errorMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });
}