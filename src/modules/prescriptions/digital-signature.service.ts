import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { DatabaseService } from '../../database/database.service';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { VerificationService } from '../verification/verification.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { plainAddPlaceholder } = require('@signpdf/placeholder-plain');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const signpdf = require('@signpdf/signpdf').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Signer } = require('@signpdf/utils');

/** "Firmante" que en realidad captura lo que hay que firmar o devuelve una firma ya hecha en el navegador */
class FirmaExterna extends Signer {
  capturado: Buffer | null = null;
  constructor(private cms?: Buffer) { super(); }
  async sign(contenido: Buffer): Promise<Buffer> {
    this.capturado = Buffer.from(contenido);
    return this.cms || Buffer.alloc(16);
  }
}

/** Bytes del PDF cubiertos por la firma (lo mismo que calcula @signpdf) */
async function bytesAFirmar(pdfConLugar: Buffer): Promise<Buffer> {
  const f = new FirmaExterna();
  await signpdf.sign(pdfConLugar, f);
  if (!f.capturado) throw new Error('sin contenido');
  return f.capturado;
}

/** Largo real de un DER (para sacar el relleno de ceros del /Contents) */
function largoDer(b: Buffer): number {
  if (b.length < 2 || b[0] !== 0x30) return b.length;
  const l = b[1];
  if (l < 0x80) return 2 + l;
  const n = l & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + b[2 + i];
  return 2 + n + len;
}

/**
 * Firma digital (Ley 25.506) de recetas con el certificado del médico, en formato PDF (PKCS#7 / CMS detached).
 * La clave privada nunca llega al servidor: el navegador firma con el .p12/.pfx del médico y devuelve
 * solo la firma CMS. El servidor la valida (integridad, vigencia, titular = médico) y la incrusta en el PDF.
 */
const SIGNATURE_LENGTH = 24576; // bytes reservados para el CMS (certificado + cadena)

// Certificadores licenciados en Argentina (coincidencia por nombre del emisor o de la cadena)
const EMISORES_LICENCIADOS = [
  /AC\s*ONTI/i, /AC\s*MODERNIZACI[OÓ]N/i, /PFDR/i, /AC\s*RA[IÍ]Z/i, /Autoridad Certificante/i,
  /AFIP/i, /ARCA/i, /ANSES/i, /ENCODE/i, /BOX CUSTODIA/i, /LAKAUT/i, /DIGILOGIX/i, /TECNOLOG[IÍ]A DE VALORES/i,
  /COLEGIO DE ESCRIBANOS/i, /Secretar[ií]a de Innovaci[oó]n/i, /Ministerio de Modernizaci[oó]n/i,
];

export interface CertInfo {
  fingerprint: string;
  subjectCn: string;
  subjectSerial: string;
  issuerCn: string;
  issuerO: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  issuerRecognized: boolean;
  usoFirma: boolean;
}

@Injectable()
export class DigitalSignatureService {
  private readonly logger = new Logger(DigitalSignatureService.name);
  constructor(private db: DatabaseService, private pdf: PrescriptionPdfService, private verification: VerificationService) {}

  static info(cert: forge.pki.Certificate, chain: forge.pki.Certificate[] = []): CertInfo {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fingerprint = crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
    const get = (attrs: any, name: string) => (attrs.getField(name)?.value as string) || '';
    const issuerCn = get(cert.issuer, 'CN'), issuerO = get(cert.issuer, 'O');
    const textoEmisores = [issuerCn, issuerO, ...chain.map((c) => `${get(c.subject, 'CN')} ${get(c.subject, 'O')}`)].join(' | ');
    const ku: any = cert.getExtension('keyUsage');
    return {
      fingerprint,
      subjectCn: get(cert.subject, 'CN'),
      subjectSerial: (cert.subject.getField({ type: '2.5.4.5' } as any)?.value as string) || '',
      issuerCn, issuerO,
      serialNumber: cert.serialNumber,
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      issuerRecognized: EMISORES_LICENCIADOS.some((r) => r.test(textoEmisores)),
      usoFirma: !ku || !!(ku.digitalSignature || ku.nonRepudiation),
    };
  }

  /** El CUIL/CUIT del certificado tiene que corresponder al DNI del médico (dígitos 3 a 10) */
  private static coincideDni(serial: string, dni: string) {
    const s = String(serial || '').replace(/\D/g, ''), d = String(dni || '').replace(/\D/g, '');
    if (!s || !d) return false;
    if (s.length === 11) return s.slice(2, 10).replace(/^0+/, '') === d.replace(/^0+/, '');
    return s.replace(/^0+/, '') === d.replace(/^0+/, '');
  }

  // ─── Certificado del médico ──────────────────────────────

  async registrarCertificado(doctorId: string, certPem: string, chainPem?: string) {
    let cert: forge.pki.Certificate;
    let chain: forge.pki.Certificate[] = [];
    try {
      cert = forge.pki.certificateFromPem(certPem);
      if (chainPem) chain = (chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map((p) => forge.pki.certificateFromPem(p));
    } catch {
      throw new BadRequestException('El certificado no es válido o usa un algoritmo no soportado (se requiere RSA)');
    }
    const i = DigitalSignatureService.info(cert, chain);
    const ahora = new Date();
    if (i.notAfter < ahora) throw new BadRequestException(`El certificado venció el ${i.notAfter.toLocaleDateString('es-AR')}`);
    if (i.notBefore > ahora) throw new BadRequestException('El certificado todavía no está vigente');
    if (!i.usoFirma) throw new BadRequestException('El certificado no está habilitado para firma digital');
    const d = await this.db.queryOne(`SELECT dni FROM doctors WHERE id = $1`, [doctorId]);
    if (!d?.dni) throw new BadRequestException('Primero cargá y verificá tu matrícula con tu DNI');
    if (!DigitalSignatureService.coincideDni(i.subjectSerial, d.dni)) {
      throw new BadRequestException(`El certificado es de otra persona (${i.subjectCn || 'sin nombre'}, ${i.subjectSerial || 'sin CUIL'}); tiene que coincidir con tu DNI`);
    }
    await this.db.query(`UPDATE doctor_certificates SET is_active = false WHERE doctor_id = $1`, [doctorId]);
    await this.db.query(
      `INSERT INTO doctor_certificates (doctor_id, fingerprint, subject_cn, subject_serial, issuer_cn, issuer_o, serial_number,
                                        not_before, not_after, issuer_recognized, cert_pem, chain_pem, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
       ON CONFLICT (doctor_id, fingerprint) DO UPDATE SET is_active = true, chain_pem = EXCLUDED.chain_pem`,
      [doctorId, i.fingerprint, i.subjectCn, i.subjectSerial, i.issuerCn, i.issuerO, i.serialNumber,
       i.notBefore, i.notAfter, i.issuerRecognized, certPem, chainPem || null],
    );
    return this.certificado(doctorId);
  }

  async certificado(doctorId: string) {
    return this.db.queryOne(
      `SELECT id, fingerprint, subject_cn, subject_serial, issuer_cn, issuer_o, serial_number, not_before, not_after,
              issuer_recognized, created_at, not_after < NOW() AS vencido
       FROM doctor_certificates WHERE doctor_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
      [doctorId],
    );
  }

  async quitarCertificado(doctorId: string) {
    await this.db.query(`UPDATE doctor_certificates SET is_active = false WHERE doctor_id = $1`, [doctorId]);
    return { ok: true };
  }

  // ─── Firma de una receta ─────────────────────────────────

  /** Paso 1: arma el PDF con el espacio para la firma y devuelve los bytes a firmar */
  async iniciar(orgId: string, doctorId: string, prescriptionId: string) {
    await this.verification.exigirVerificado(doctorId);
    const rx = await this.db.queryOne(
      `SELECT id, doctor_id, status, signed_pdf IS NOT NULL AS firmada FROM prescriptions WHERE id = $1 AND organization_id = $2`,
      [prescriptionId, orgId],
    );
    if (!rx) throw new NotFoundException('Receta no encontrada');
    if (rx.doctor_id !== doctorId) throw new ForbiddenException('Solo quien emitió la receta puede firmarla');
    if (rx.firmada) throw new BadRequestException('La receta ya está firmada digitalmente');
    if (rx.status === 'cancelled') throw new BadRequestException('La receta está anulada');
    const cert = await this.certificado(doctorId);
    if (!cert) throw new BadRequestException('Cargá tu certificado de firma digital en Matrícula y firma');
    if (cert.vencido) throw new BadRequestException('Tu certificado de firma digital está vencido');

    const base = await this.pdf.generatePdf(orgId, prescriptionId, {
      firmaDigital: { titular: cert.subject_cn, cuil: cert.subject_serial, emisor: cert.issuer_cn || cert.issuer_o },
    });
    const conLugar: Buffer = plainAddPlaceholder({
      pdfBuffer: base,
      reason: 'Receta electrónica — Ley 27.553',
      contactInfo: 'contact@rispy.io',
      name: cert.subject_cn || 'Médico',
      location: 'Argentina',
      signatureLength: SIGNATURE_LENGTH,
    });
    // Se usa el propio algoritmo de @signpdf para calcular el ByteRange y obtener exactamente lo que se firma
    const aFirmar = await bytesAFirmar(conLugar).catch(() => null);
    if (!aFirmar) throw new BadRequestException('No se pudo preparar el PDF para firmar');
    const sha = crypto.createHash('sha256').update(aFirmar).digest('hex');
    const s = await this.db.queryOne(
      `INSERT INTO prescription_signing_sessions (prescription_id, doctor_id, certificate_id, placeholder_pdf, content_sha256)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [prescriptionId, doctorId, cert.id, conLugar, sha],
    );
    return { sessionId: s.id, contenido: aFirmar.toString('base64'), sha256: sha, certificado: cert.fingerprint };
  }

  /** Paso 2: recibe la firma CMS del navegador, la valida y la incrusta */
  async completar(orgId: string, doctorId: string, prescriptionId: string, sessionId: string, cmsB64: string) {
    const s = await this.db.queryOne(
      `SELECT s.*, c.fingerprint, c.subject_serial FROM prescription_signing_sessions s
       JOIN doctor_certificates c ON c.id = s.certificate_id
       WHERE s.id = $1 AND s.prescription_id = $2 AND s.doctor_id = $3`,
      [sessionId, prescriptionId, doctorId],
    );
    if (!s) throw new NotFoundException('Sesión de firma no encontrada');
    if (new Date(s.expires_at) < new Date()) throw new BadRequestException('La sesión de firma venció; volvé a intentar');
    const cms = Buffer.from(String(cmsB64 || ''), 'base64');
    if (cms.length < 200 || cms.length * 2 > SIGNATURE_LENGTH * 2) throw new BadRequestException('Firma inválida');

    const aFirmar = await bytesAFirmar(s.placeholder_pdf);
    if (crypto.createHash('sha256').update(aFirmar).digest('hex') !== s.content_sha256) throw new BadRequestException('El documento cambió; volvé a intentar');
    const v = DigitalSignatureService.verificarCms(aFirmar, cms);
    if (!v.ok) throw new BadRequestException(`La firma no es válida: ${v.motivo}`);
    if (v.cert && DigitalSignatureService.info(v.cert).fingerprint !== s.fingerprint) {
      throw new BadRequestException('La firma se hizo con un certificado distinto al registrado');
    }
    const firmado: Buffer = await signpdf.sign(s.placeholder_pdf, new FirmaExterna(cms));
    await this.db.query(
      `UPDATE prescriptions SET signed_pdf = $2, digital_signed_at = NOW(), digital_certificate_id = $3 WHERE id = $1`,
      [prescriptionId, firmado, s.certificate_id],
    );
    await this.db.query(`DELETE FROM prescription_signing_sessions WHERE prescription_id = $1`, [prescriptionId]);
    this.logger.log(`Receta ${prescriptionId} firmada digitalmente (${s.fingerprint.slice(0, 12)})`);
    return { ok: true, firmadaEl: new Date(), titular: v.titular, emisor: v.emisor };
  }

  /** Valida un CMS detached (PKCS#7) sobre un contenido */
  static verificarCms(contenido: Buffer, cms: Buffer): { ok: boolean; motivo?: string; cert?: forge.pki.Certificate; titular?: string; emisor?: string; fecha?: Date } {
    try {
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(cms.toString('binary')));
      const msg: any = forge.pkcs7.messageFromAsn1(asn1);
      const rc = msg.rawCapture;
      const certs: forge.pki.Certificate[] = msg.certificates || [];
      if (!certs.length) return { ok: false, motivo: 'la firma no incluye el certificado' };
      // Certificado firmante: el que coincide con el emisor+serie del SignerInfo, o el primero que no es de una AC
      const serie = rc.serial ? forge.util.bytesToHex(rc.serial) : null;
      const cert = certs.find((c) => serie && c.serialNumber.replace(/^0+/, '') === serie.replace(/^0+/, ''))
        || certs.find((c) => !(c.getExtension('basicConstraints') as any)?.cA) || certs[0];
      const attrs = rc.authenticatedAttributes;
      if (!attrs) return { ok: false, motivo: 'faltan atributos firmados' };
      const oidDigest = forge.pki.oids.messageDigest, oidTime = forge.pki.oids.signingTime;
      let digest: string | null = null, fecha: Date | undefined;
      for (const a of attrs) {
        const oid = forge.asn1.derToOid(a.value[0].value);
        if (oid === oidDigest) digest = a.value[1].value[0].value;
        if (oid === oidTime) { try { fecha = forge.asn1.utcTimeToDate(a.value[1].value[0].value); } catch { /* */ } }
      }
      const algo = forge.asn1.derToOid(rc.digestAlgorithm);
      const nombreAlgo = algo === forge.pki.oids.sha256 ? 'sha256' : algo === forge.pki.oids.sha512 ? 'sha512' : algo === forge.pki.oids.sha384 ? 'sha384' : algo === forge.pki.oids.sha1 ? 'sha1' : null;
      if (!nombreAlgo) return { ok: false, motivo: 'algoritmo de resumen no soportado' };
      const h = crypto.createHash(nombreAlgo).update(contenido).digest('binary');
      if (digest !== h) return { ok: false, motivo: 'el documento no coincide con lo firmado' };
      const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
      const md = (forge.md as any)[nombreAlgo].create();
      md.update(forge.asn1.toDer(set).getBytes());
      const ok = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().bytes(), rc.signature);
      if (!ok) return { ok: false, motivo: 'la firma criptográfica no corresponde al certificado' };
      const cuando = fecha || new Date();
      if (cuando > cert.validity.notAfter || cuando < cert.validity.notBefore) return { ok: false, motivo: 'el certificado no estaba vigente al firmar' };
      return { ok: true, cert, titular: (cert.subject.getField('CN')?.value as string) || '', emisor: (cert.issuer.getField('CN')?.value as string) || '', fecha };
    } catch (e) {
      return { ok: false, motivo: `no se pudo leer la firma (${e.message})` };
    }
  }

  /** Verifica la firma incrustada en el PDF guardado (para la página pública) */
  async verificarReceta(prescriptionId: string) {
    const rx = await this.db.queryOne(
      `SELECT rx.signed_pdf, rx.digital_signed_at, c.subject_cn, c.subject_serial, c.issuer_cn, c.issuer_o, c.not_before, c.not_after,
              c.issuer_recognized, c.fingerprint
       FROM prescriptions rx LEFT JOIN doctor_certificates c ON c.id = rx.digital_certificate_id WHERE rx.id = $1`,
      [prescriptionId],
    );
    if (!rx?.signed_pdf) return { firmada: false };
    const pdf: Buffer = rx.signed_pdf;
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(pdf.toString('latin1'));
    let valida = false, motivo = 'No se encontró la firma en el PDF';
    if (m) {
      const [a, b, c, d] = m.slice(1).map(Number);
      const contenido = Buffer.concat([pdf.slice(a, a + b), pdf.slice(c, c + d)]);
      const crudo = Buffer.from(pdf.slice(a + b + 1, c - 1).toString('latin1'), 'hex');
      const cms = crudo.slice(0, largoDer(crudo));
      const v = DigitalSignatureService.verificarCms(contenido, cms);
      valida = v.ok; motivo = v.ok ? 'Firma digital válida: el documento no fue modificado' : v.motivo || 'Firma inválida';
    }
    return {
      firmada: true, valida, motivo, firmadaEl: rx.digital_signed_at,
      titular: rx.subject_cn, cuil: rx.subject_serial, emisor: rx.issuer_cn || rx.issuer_o,
      emisorLicenciado: rx.issuer_recognized, vigenciaDesde: rx.not_before, vigenciaHasta: rx.not_after,
      huella: rx.fingerprint,
    };
  }
}
