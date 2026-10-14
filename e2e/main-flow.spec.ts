import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Flujo principal completo, en escritorio y en móvil:
 * profesor crea grupo → alumno se une → completa Home y una evidencia con archivo → profesor acepta,
 * registra autorización → alumno solicita publicación → profesor aprueba y publica → visitante ve la
 * página pública → el alumno la retira → la URL deja de mostrar contenido.
 */
const PASSWORD = 'contraseña-e2e-123';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function newPage(browser: Browser) {
  const ctx = await browser.newContext(test.info().project.use);
  return ctx.newPage();
}

test('flujo principal profesor → alumno → publicación → retirada', async ({ browser }) => {
  const suffix = test.info().project.name;
  const teacherEmail = `profe.${suffix}@centro.test`;
  const username = `alba.${suffix}`;

  // ---- Profesor: registro y grupo
  const teacher = await newPage(browser);
  await teacher.goto('/registro-profesor');
  await teacher.getByLabel('Nombre visible').fill('Profe E2E');
  await teacher.getByLabel('Email').fill(teacherEmail);
  await teacher.getByLabel(/^Contraseña/).fill(PASSWORD);
  await teacher.getByLabel('Código de registro del piloto').fill('e2e-code');
  await teacher.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(teacher.getByRole('heading', { name: /Hola, Profe E2E/ })).toBeVisible();

  await teacher.getByLabel('Nombre del grupo').fill(`4ºB ${suffix}`);
  await teacher.getByRole('button', { name: 'Crear grupo' }).click();
  await expect(teacher.getByRole('heading', { name: new RegExp(`4ºB ${suffix}`) })).toBeVisible();
  const groupUrl = teacher.url();
  await teacher.getByRole('button', { name: 'Generar código' }).click();
  const code = (await teacher.locator('.big-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);

  // ---- Alumno: registro con código y edición
  const student = await newPage(browser);
  await student.goto('/unirse');
  await student.getByLabel(/Código del grupo/).fill(code);
  await student.getByLabel('Tu nombre de pila').fill('Alba');
  await student.getByLabel(/Nombre de usuario/).fill(username);
  await student.getByLabel(/^Contraseña/).fill(PASSWORD);
  await student.getByLabel('Repite la contraseña').fill(PASSWORD);
  await student.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(student.getByRole('heading', { name: 'Hi, Alba!' })).toBeVisible();
  await student.getByRole('button', { name: /Abrir: My Linguistic Portfolio/ }).click();
  await expect(student.getByRole('tab', { name: /Home/ })).toBeVisible();

  await student.getByRole('textbox', { name: /About me/ }).fill('I love music <b>and</b> English songs.');
  await expect(student.getByText('Todos los cambios guardados ✓')).toBeVisible({ timeout: 10_000 });
  await student.reload();
  await expect(student.getByRole('textbox', { name: /About me/ })).toHaveValue('I love music <b>and</b> English songs.');

  // Evidencia con archivo
  await student.getByRole('tab', { name: /My Dossier/ }).click();
  await student.getByRole('button', { name: '+ Añadir evidencia' }).click();
  await student.getByLabel('Subir archivo').setInputFiles({ name: 'essay.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(student.getByText('Archivo subido ✓')).toBeVisible();
  await student.getByRole('textbox', { name: /What did I learn/ }).fill('New adjectives');
  await student.getByRole('textbox', { name: /How will I improve/ }).fill('More connectors');
  await student.getByRole('button', { name: 'Guardar y entregar al profesor' }).click();
  await expect(student.locator('.evidence-card .badge', { hasText: 'Entregada' })).toBeVisible();

  // ---- Aislamiento: el alumno no puede abrir la página del grupo del profesor
  const sp = await student.context().newPage();
  await sp.goto(groupUrl.replace(/^https?:\/\/[^/]+/, ''));
  await expect(sp.getByText('Recurso no encontrado')).toBeVisible();
  await sp.close();

  // ---- Profesor: autorización, revisión de la evidencia
  await teacher.reload();
  teacher.once('dialog', (d) => void d.accept('Autorización familia firmada, archivada en secretaría'));
  await teacher.getByRole('button', { name: 'Registrar' }).click();
  await expect(teacher.getByText('Registrada')).toBeVisible();
  await teacher.locator('#main').getByRole('link', { name: 'My Linguistic Portfolio' }).click();
  await teacher.getByRole('link', { name: 'Alba' }).click();
  await teacher.getByRole('tab', { name: /My Dossier/ }).click();
  await teacher.getByRole('button', { name: 'Aceptar' }).click();
  await expect(teacher.locator('.badge', { hasText: 'Aceptada' })).toBeVisible();
  const portfolioUrl = teacher.url();

  // ---- Alumno: solicita publicación
  await student.reload();
  await student.getByRole('tab', { name: 'Publicación' }).click();
  await student.getByLabel(/Nombre público/).fill('Alba R.');
  await student.getByRole('button', { name: 'Enviar a mi profesor' }).click();
  await expect(student.getByText('Solicitud enviada.')).toBeVisible();

  // ---- Profesor: aprueba y publica
  await teacher.goto(portfolioUrl);
  await teacher.getByRole('tab', { name: 'Publicación' }).click();
  await teacher.getByRole('button', { name: 'Aprobar' }).click();
  await teacher.getByRole('button', { name: 'Publicar ahora' }).click();
  const link = teacher.locator('.notice a[href*="/p/"]');
  await expect(link).toBeVisible();
  const publicUrl = (await link.getAttribute('href'))!;

  // ---- Visitante anónimo
  const visitor = await newPage(browser);
  await visitor.goto(publicUrl);
  await expect(visitor.getByRole('heading', { name: /Alba/ }).first()).toBeVisible();
  // El HTML introducido por el alumno se muestra como texto, no se interpreta
  await expect(visitor.getByText('I love music <b>and</b> English songs.')).toBeVisible();
  await expect(visitor.locator('b', { hasText: 'and' })).toHaveCount(0);
  await expect(visitor.getByText(username)).toHaveCount(0);

  // ---- Alumno retira la publicación
  await student.reload();
  await student.getByRole('tab', { name: 'Publicación' }).click();
  student.once('dialog', (d) => void d.accept());
  await student.getByRole('button', { name: 'Retirar publicación' }).click();
  await expect(student.getByRole('button', { name: 'Retirar publicación' })).toHaveCount(0);
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'Portfolio no disponible' })).toBeVisible();
});

test('página pública inexistente y rutas protegidas sin sesión', async ({ page }: { page: Page }) => {
  await page.goto('/p/AAAAAAAAAAAA');
  await expect(page.getByRole('heading', { name: 'Portfolio no disponible' })).toBeVisible();
  await page.goto('/grupos/00000000-0000-4000-8000-000000000000');
  await expect(page).toHaveURL(/\/login$/);
});
