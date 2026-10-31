# Concepts

## What is Featherbone?

In this guide you will see references to both “Featherbone” and “Job Shop,” which may be a bit confusing at first. How is Featherbone different from Job Shop? Featherbone is the framework that provides the structure and navigational elements to build a database application, like the way you use your favorite spreadsheet program to build a series of tables and data. Job Shop is a specific application built on Featherbone to help manufacturers run their business. When we talk about Featherbone, we’re talking about general principles that apply throughout the system. When we talk about Job Shop, we’re talking about a specific feature built in the Job Shop application to support the manufacturing cycle.

Job Shop itself has three editions: Standard, Professional and Enterprise where Standard provides functionality needed for material control, Professional adds tools for operations management, and Enterprise adds capabilities for more mature companies such as physical inventory count. This document will call out when certain features are only available in certain editions.

## Global settings

Global settings are opened with Settings in the Global group on the Home tab. The button is only enabled for user accounts assigned the administrator role.

![Settings in the Home tab's Global group](images/global-settings-1.png)

Clicking it opens the global settings.

![Global settings](images/global-settings-2.png)

The address appears on all printed forms. On the Logo tab, click the box or drop an image on it to upload your logo, which then prints on all forms to tailor Job Shop to your business; Clear goes back to the Featherbone logo. Use a JPEG or PNG image: anything else prints without a logo. Both settings are optional.

Select the SMTP Credentials tab for the email settings used to send printed forms by email.

![Global email settings](images/global-settings-3.png)

If SMTP is used, enter credentials as pictured for an email account that will be used to send all forms. If you choose Gmail, no credentials will be required, but instead when a user attempts to send a form, they will be prompted with their own Gmail account and credentials to send mail, and it will be sent from their Gmail account.
