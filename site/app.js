const pageLanguage = document.documentElement.lang === 'en' ? 'en' : 'id';
const buttons = [...document.querySelectorAll('[data-set-lang]')];

buttons.forEach(button => {
  const language = button.dataset.setLang;
  button.setAttribute('aria-pressed', String(language === pageLanguage));
  button.addEventListener('click', () => {
    if (language === pageLanguage) return;
    window.location.href = pageLanguage === 'id' ? './en/' : '../';
  });
});
