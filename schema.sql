Warning: Permanently added '31.97.103.63' (ED25519) to the list of known hosts.
--
-- PostgreSQL database dump
--

\restrict QqBcPuItzsH4kq01do2iI6Ri1yrn4VaGvVOQ2ON1x6NptlAWsIycCcb6jRmWyJH

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: appointment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_status AS ENUM (
    'pending',
    'confirmed',
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
    'pending_payment',
    'pending_approval'
);


--
-- Name: blood_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blood_type AS ENUM (
    'A+',
    'A-',
    'B+',
    'B-',
    'AB+',
    'AB-',
    'O+',
    'O-',
    'unknown'
);


--
-- Name: booking_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_mode AS ENUM (
    'open',
    'approval',
    'deposit',
    'deposit_approval'
);


--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_status AS ENUM (
    'pending_payment',
    'pending_approval',
    'confirmed',
    'rejected',
    'cancelled',
    'expired'
);


--
-- Name: connector_health; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connector_health AS ENUM (
    'healthy',
    'degraded',
    'down',
    'unknown'
);


--
-- Name: connector_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connector_kind AS ENUM (
    'api',
    'portal',
    'manual',
    'offline'
);


--
-- Name: gender_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender_type AS ENUM (
    'male',
    'female',
    'other',
    'not_specified'
);


--
-- Name: invite_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invite_status AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'expired'
);


--
-- Name: message_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_type AS ENUM (
    'text',
    'image',
    'file',
    'prescription',
    'appointment'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'appointment_reminder',
    'new_message',
    'prescription_ready',
    'appointment_confirmed',
    'appointment_cancelled'
);


--
-- Name: org_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.org_role AS ENUM (
    'owner',
    'admin',
    'doctor',
    'secretary'
);


--
-- Name: org_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.org_type AS ENUM (
    'consultorio',
    'centro_medico',
    'clinica',
    'hospital',
    'individual'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'transfer',
    'cash',
    'both'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'proof_uploaded',
    'confirmed',
    'rejected',
    'refunded'
);


--
-- Name: prescription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prescription_status AS ENUM (
    'active',
    'expired',
    'cancelled'
);


--
-- Name: store_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.store_type AS ENUM (
    'apple',
    'google',
    'manual'
);


--
-- Name: subscription_plan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_plan AS ENUM (
    'free',
    'pro'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'active',
    'expired',
    'cancelled',
    'grace_period',
    'billing_retry'
);


--
-- Name: validation_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.validation_result AS ENUM (
    'approved',
    'rejected',
    'pending',
    'error',
    'manual_review'
);


--
-- Name: cleanup_affiliate_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_affiliate_cache() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM affiliate_cache WHERE expires_at < NOW();
END;
$$;


--
-- Name: cleanup_expired_holds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_holds() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM slot_holds WHERE expires_at < NOW();
    
    UPDATE booking_requests
    SET status = 'expired'
    WHERE status = 'pending_payment'
      AND payment_deadline < NOW();
END;
$$;


--
-- Name: expire_prescriptions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_prescriptions() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE prescriptions 
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active' AND expires_at < NOW();
END;
$$;


--
-- Name: fn_audit_appointments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_appointments() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data)
    VALUES ('appointments', NEW.id, 'UPDATE',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_audit_consents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_consents() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES ('informed_consents', NEW.id, 'INSERT', to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES ('informed_consents', NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: fn_audit_medical_records(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_medical_records() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES ('medical_records', NEW.id, 'INSERT', to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES ('medical_records', NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
    VALUES ('medical_records', OLD.id, 'DELETE', to_jsonb(OLD), OLD.doctor_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_type character varying(20) NOT NULL,
    action character varying(50) NOT NULL,
    resource_type character varying(50),
    resource_id uuid,
    ip_address character varying(45),
    user_agent text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_logs_user_type_check CHECK (((user_type)::text = ANY ((ARRAY['doctor'::character varying, 'secretary'::character varying, 'patient'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: TABLE access_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.access_logs IS 'Registro de acceso — quién vio qué y cuándo (Ley 26.529 trazabilidad)';


--
-- Name: admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    doctor_id uuid NOT NULL,
    token character varying(64) DEFAULT encode(public.gen_random_bytes(32), 'hex'::text) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '08:00:00'::interval) NOT NULL,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliate_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_cache (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    insurer_id uuid NOT NULL,
    affiliate_number character varying(60) NOT NULL,
    document_number character varying(20),
    is_valid boolean,
    full_name character varying(200),
    plan_code character varying(50),
    plan_name character varying(200),
    coverage jsonb DEFAULT '{}'::jsonb,
    validated_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    org_doctor_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    status public.appointment_status DEFAULT 'pending'::public.appointment_status,
    reason text,
    notes text,
    is_first_visit boolean DEFAULT false,
    is_online boolean DEFAULT false,
    room_number character varying(20),
    created_by_type character varying(20) DEFAULT 'doctor'::character varying,
    created_by_id uuid,
    reminder_sent boolean DEFAULT false,
    reminder_sent_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by character varying(20),
    cancelled_reason text,
    sync_status character varying(20) DEFAULT 'synced'::character varying,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    checked_in_at timestamp with time zone,
    checked_in_by character varying(50)
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id uuid NOT NULL,
    action character varying(10) NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address character varying(45),
    user_agent text,
    CONSTRAINT audit_log_action_check CHECK (((action)::text = ANY ((ARRAY['INSERT'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying])::text[])))
);


--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_log IS 'Registro de auditoría — cambios en datos clínicos (Ley 26.529 inalterabilidad)';


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    doctor_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(50),
    entity_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: billing_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_batches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    insurer_id uuid NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    batch_number character varying(40),
    status character varying(30) DEFAULT 'draft'::character varying,
    total_items integer DEFAULT 0,
    total_amount numeric(14,2) DEFAULT 0,
    accepted_amount numeric(14,2),
    rejected_amount numeric(14,2),
    submitted_at timestamp with time zone,
    resolved_at timestamp with time zone,
    export_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: billing_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    batch_id uuid NOT NULL,
    patient_id uuid,
    appointment_id uuid,
    medical_record_id uuid,
    doctor_id uuid,
    service_date date NOT NULL,
    nomenclator_code character varying(30) NOT NULL,
    description text,
    quantity integer DEFAULT 1,
    unit_amount numeric(12,2),
    total_amount numeric(12,2),
    affiliate_number character varying(60),
    plan_code character varying(50),
    diagnosis_code character varying(10),
    authorization_code character varying(60),
    audit_status character varying(20) DEFAULT 'pending'::character varying,
    audit_notes text[],
    is_accepted boolean,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: booking_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    org_doctor_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    patient_id uuid,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    dni character varying(20),
    email character varying(255),
    phone character varying(20) NOT NULL,
    date_of_birth date,
    insurance_provider character varying(200),
    insurance_number character varying(50),
    requested_date date NOT NULL,
    requested_start_time time without time zone NOT NULL,
    requested_end_time time without time zone NOT NULL,
    reason text,
    is_first_visit boolean DEFAULT true,
    status public.booking_status DEFAULT 'pending_approval'::public.booking_status,
    deposit_required numeric(10,2),
    payment_status public.payment_status DEFAULT 'pending'::public.payment_status,
    payment_method character varying(20),
    payment_proof_url text,
    payment_reference character varying(100),
    payment_confirmed_at timestamp with time zone,
    payment_deadline timestamp with time zone,
    confirmation_token character varying(64) DEFAULT encode(public.gen_random_bytes(32), 'hex'::text),
    appointment_id uuid,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    rejection_reason text,
    source character varying(50) DEFAULT 'public_link'::character varying,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: booking_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    org_doctor_id uuid NOT NULL,
    is_enabled boolean DEFAULT false,
    public_slug character varying(100),
    booking_mode public.booking_mode DEFAULT 'open'::public.booking_mode,
    requires_deposit boolean DEFAULT false,
    deposit_amount numeric(10,2),
    deposit_percentage integer,
    consultation_fee numeric(10,2),
    payment_methods public.payment_method DEFAULT 'both'::public.payment_method,
    bank_name character varying(100),
    bank_account_holder character varying(200),
    bank_cbu character varying(30),
    bank_alias character varying(50),
    payment_deadline_minutes integer DEFAULT 120,
    charge_on_no_show boolean DEFAULT false,
    no_show_fee numeric(10,2),
    keeps_deposit_on_no_show boolean DEFAULT true,
    min_hours_before_cancel integer DEFAULT 24,
    refund_on_early_cancel boolean DEFAULT true,
    max_days_in_advance integer DEFAULT 60,
    min_hours_in_advance integer DEFAULT 2,
    allow_new_patients boolean DEFAULT true,
    requires_insurance_info boolean DEFAULT false,
    allows_prepaid_prescription boolean DEFAULT false,
    prescription_requires_payment boolean DEFAULT true,
    welcome_message text,
    instructions text,
    cancellation_policy_text text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deposit_deadline_minutes integer DEFAULT 60,
    bank_holder character varying(200),
    accepted_insurance text[]
);


--
-- Name: chatbot_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chatbot_config (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    org_doctor_id uuid NOT NULL,
    is_enabled boolean DEFAULT true,
    welcome_message text DEFAULT '¡Hola! 👋 Soy el asistente de este consultorio. ¿En qué puedo ayudarte?'::text,
    fallback_message text DEFAULT 'No tengo esa información. Podés comunicarte directamente al consultorio.'::text,
    consultation_fee numeric(10,2),
    accepted_insurance text[],
    schedule_text text,
    address_text text,
    phone text,
    whatsapp text,
    extra_info text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: chatbot_faqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chatbot_faqs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chatbot_config_id uuid NOT NULL,
    question text NOT NULL,
    keywords text[] NOT NULL,
    answer text NOT NULL,
    category character varying(50),
    sort_order smallint DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: connectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connectors (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    insurer_id uuid NOT NULL,
    adapter_key character varying(60) NOT NULL,
    kind public.connector_kind NOT NULL,
    priority integer DEFAULT 100,
    can_validate_affiliate boolean DEFAULT false,
    can_authorize_practice boolean DEFAULT false,
    can_submit_batch boolean DEFAULT false,
    can_query_status boolean DEFAULT false,
    config jsonb DEFAULT '{}'::jsonb,
    health public.connector_health DEFAULT 'unknown'::public.connector_health,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0,
    avg_latency_ms integer,
    max_requests_per_minute integer DEFAULT 30,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    last_message_text text,
    last_message_at timestamp with time zone,
    doctor_unread_count integer DEFAULT 0,
    patient_unread_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    doctor_id uuid,
    patient_auth_id uuid,
    staff_id uuid,
    token text NOT NULL,
    platform character varying(10) NOT NULL,
    device_name character varying(100),
    app_version character varying(20),
    os_version character varying(20),
    is_active boolean DEFAULT true,
    last_used_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_device_owner CHECK ((((((doctor_id IS NOT NULL))::integer + ((patient_auth_id IS NOT NULL))::integer) + ((staff_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT device_tokens_platform_check CHECK (((platform)::text = ANY ((ARRAY['ios'::character varying, 'android'::character varying, 'web'::character varying])::text[])))
);


--
-- Name: doctor_reminder_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_reminder_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    doctor_id uuid NOT NULL,
    appointment_reminder_enabled boolean DEFAULT true,
    appointment_reminder_minutes integer[] DEFAULT '{30}'::integer[],
    appointment_reminder_push boolean DEFAULT true,
    appointment_reminder_email boolean DEFAULT false,
    daily_summary_enabled boolean DEFAULT false,
    daily_summary_time time without time zone DEFAULT '08:00:00'::time without time zone,
    daily_summary_days integer[] DEFAULT '{1,2,3,4,5}'::integer[],
    new_message_enabled boolean DEFAULT true,
    new_message_push boolean DEFAULT true,
    new_message_sound boolean DEFAULT true,
    prescription_expiry_enabled boolean DEFAULT true,
    prescription_expiry_days integer DEFAULT 7,
    cancellation_alert_enabled boolean DEFAULT true,
    no_show_alert_enabled boolean DEFAULT true,
    quiet_hours_enabled boolean DEFAULT false,
    quiet_hours_start time without time zone DEFAULT '22:00:00'::time without time zone,
    quiet_hours_end time without time zone DEFAULT '07:00:00'::time without time zone,
    cross_org_conflict_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: doctor_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_schedules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    org_doctor_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    slot_duration_minutes integer DEFAULT 30,
    max_patients_per_slot integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT doctor_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: doctors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctors (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone character varying(20),
    dni character varying(20),
    medical_license character varying(50) NOT NULL,
    medical_license_province character varying(100),
    specialty character varying(100) DEFAULT 'Clínica médica'::character varying,
    secondary_specialties text[],
    avatar_url text,
    bio text,
    refresh_token_hash character varying(255),
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    email_verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    role character varying(20) DEFAULT 'doctor'::character varying,
    is_platform_admin boolean DEFAULT false,
    signature_image text,
    refeps_code character varying(50)
);


--
-- Name: COLUMN doctors.signature_image; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.doctors.signature_image IS 'Base64 data URI of doctor signature image for prescription PDFs';


--
-- Name: feature_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_usage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    doctor_id uuid NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    appointments_count integer DEFAULT 0,
    organizations_count integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: hub_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    insurer_id uuid NOT NULL,
    connector_id uuid,
    operation character varying(40) NOT NULL,
    idempotency_key character varying(100),
    payload jsonb NOT NULL,
    result public.validation_result,
    response jsonb,
    authorization_code character varying(60),
    error_code character varying(60),
    error_message text,
    attempts integer DEFAULT 0,
    latency_ms integer,
    raw_response text,
    patient_id uuid,
    appointment_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: informed_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.informed_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    consent_type character varying(50) DEFAULT 'historia_clinica_digital'::character varying NOT NULL,
    consent_text text NOT NULL,
    accepted boolean DEFAULT false NOT NULL,
    accepted_at timestamp with time zone,
    ip_address character varying(45),
    user_agent text,
    signature_data text,
    revoked_at timestamp with time zone,
    revoked_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE informed_consents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.informed_consents IS 'Consentimientos informados digitales (Ley 26.529 Art. 5)';


--
-- Name: insurer_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurer_plans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    insurer_id uuid NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: insurers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rnos_code character varying(20),
    cuit character varying(13),
    name character varying(200) NOT NULL,
    short_name character varying(60),
    kind character varying(30) DEFAULT 'obra_social'::character varying,
    province character varying(100),
    is_national boolean DEFAULT true,
    logo_url text,
    brand_color character varying(7),
    is_active boolean DEFAULT true,
    affiliate_count integer,
    aliases text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    invited_email character varying(255) NOT NULL,
    invited_doctor_id uuid,
    role public.org_role DEFAULT 'doctor'::public.org_role NOT NULL,
    status public.invite_status DEFAULT 'pending'::public.invite_status,
    token character varying(100) DEFAULT encode(public.gen_random_bytes(32), 'hex'::text) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: medical_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medical_records (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    appointment_id uuid,
    date timestamp with time zone DEFAULT now(),
    chief_complaint text NOT NULL,
    present_illness text,
    vital_signs jsonb DEFAULT '{}'::jsonb,
    physical_exam text,
    diagnosis text NOT NULL,
    diagnosis_code character varying(10),
    secondary_diagnoses jsonb DEFAULT '[]'::jsonb,
    treatment_plan text,
    lab_orders text[],
    imaging_orders text[],
    referrals text[],
    private_notes text,
    sync_status character varying(20) DEFAULT 'synced'::character varying,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    record_type character varying(50) DEFAULT 'consulta'::character varying,
    personal_history text,
    family_history text,
    current_medications text,
    allergies text,
    habits text,
    systems_review text,
    other_symptoms text,
    findings text,
    instructions text,
    follow_up text,
    prevention text,
    occupation text,
    deleted_at timestamp with time zone,
    doctor_license character varying(50),
    doctor_license_province character varying(100),
    doctor_specialty character varying(100),
    doctor_full_name character varying(200)
);


--
-- Name: COLUMN medical_records.record_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.record_type IS 'Type: primera_consulta, seguimiento, urgencia, control';


--
-- Name: COLUMN medical_records.personal_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.personal_history IS 'Antecedentes personales evaluados';


--
-- Name: COLUMN medical_records.family_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.family_history IS 'Antecedentes familiares';


--
-- Name: COLUMN medical_records.current_medications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.current_medications IS 'Medicación habitual';


--
-- Name: COLUMN medical_records.allergies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.allergies IS 'Alergias reportadas en la consulta';


--
-- Name: COLUMN medical_records.habits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.habits IS 'Hábitos evaluados (tabaco, alcohol, ejercicio, etc.)';


--
-- Name: COLUMN medical_records.systems_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.systems_review IS 'Revisión por sistemas';


--
-- Name: COLUMN medical_records.other_symptoms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.other_symptoms IS 'Otros síntomas / negativos';


--
-- Name: COLUMN medical_records.findings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.findings IS 'Hallazgos relevantes del examen';


--
-- Name: COLUMN medical_records.instructions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.instructions IS 'Indicaciones al paciente';


--
-- Name: COLUMN medical_records.follow_up; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.follow_up IS 'Plan de seguimiento';


--
-- Name: COLUMN medical_records.prevention; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.prevention IS 'Prevención evaluada';


--
-- Name: COLUMN medical_records.occupation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.occupation IS 'Ocupación del paciente al momento de la consulta';


--
-- Name: COLUMN medical_records.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.deleted_at IS 'Soft-delete timestamp — registros clínicos nunca se borran físicamente (Ley 26.529)';


--
-- Name: COLUMN medical_records.doctor_license; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.doctor_license IS 'Matrícula del profesional al momento de firmar (Ley 26.529 firma electrónica)';


--
-- Name: COLUMN medical_records.doctor_license_province; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.doctor_license_province IS 'Provincia de la matrícula al momento de firmar';


--
-- Name: COLUMN medical_records.doctor_specialty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.doctor_specialty IS 'Especialidad del profesional al momento de firmar';


--
-- Name: COLUMN medical_records.doctor_full_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medical_records.doctor_full_name IS 'Nombre completo del profesional al momento de firmar';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_type character varying(10) NOT NULL,
    sender_id uuid NOT NULL,
    message_type public.message_type DEFAULT 'text'::public.message_type,
    content text NOT NULL,
    attachment_url text,
    attachment_name character varying(255),
    prescription_id uuid,
    appointment_id uuid,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    sync_status character varying(20) DEFAULT 'synced'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT messages_sender_type_check CHECK (((sender_type)::text = ANY ((ARRAY['doctor'::character varying, 'patient'::character varying])::text[])))
);


--
-- Name: nomenclator_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nomenclator_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    nomenclator_id uuid NOT NULL,
    code character varying(30) NOT NULL,
    description text NOT NULL,
    specialty character varying(100),
    professional_units numeric(10,2),
    operative_units numeric(10,2),
    amount numeric(12,2),
    requires_authorization boolean DEFAULT false,
    requires_diagnosis boolean DEFAULT true,
    max_per_period integer,
    period_days integer,
    min_age integer,
    max_age integer,
    gender_restriction character varying(10),
    coinsurance numeric(12,2)
);


--
-- Name: nomenclators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nomenclators (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    insurer_id uuid,
    organization_id uuid,
    name character varying(200) NOT NULL,
    source character varying(60),
    valid_from date NOT NULL,
    valid_to date,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    unit_value numeric(12,4),
    default_consultation_code character varying(30)
);


--
-- Name: COLUMN nomenclators.unit_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nomenclators.unit_value IS 'Valor del galeno/unidad para este período. NULL si los items traen importe directo.';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    recipient_type character varying(20) NOT NULL,
    recipient_id uuid NOT NULL,
    type public.notification_type NOT NULL,
    title character varying(255) NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    push_sent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: organization_doctors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_doctors (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    role public.org_role DEFAULT 'doctor'::public.org_role NOT NULL,
    is_owner boolean DEFAULT false,
    consultation_fee numeric(10,2),
    slot_duration_minutes integer,
    room_number character varying(20),
    is_active boolean DEFAULT true,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(200) NOT NULL,
    type public.org_type DEFAULT 'consultorio'::public.org_type NOT NULL,
    cuit character varying(13),
    tax_name character varying(200),
    phone character varying(20),
    email character varying(255),
    website character varying(255),
    address text,
    city character varying(100),
    province character varying(100),
    postal_code character varying(10),
    latitude numeric(10,7),
    longitude numeric(10,7),
    logo_url text,
    primary_color character varying(7) DEFAULT '#2563EB'::character varying,
    default_slot_duration integer DEFAULT 30,
    allow_online_booking boolean DEFAULT false,
    timezone character varying(50) DEFAULT 'America/Argentina/Buenos_Aires'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: patient_auth; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_auth (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid NOT NULL,
    phone character varying(20) NOT NULL,
    pin_hash character varying(255),
    otp_code character varying(6),
    otp_expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    refresh_token_hash character varying(255),
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email character varying(255),
    password_hash character varying(255),
    is_verified boolean DEFAULT false,
    verification_code character varying(10)
);


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    referred_from_org_id uuid,
    dni character varying(20),
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255),
    phone character varying(20),
    date_of_birth date,
    gender public.gender_type DEFAULT 'not_specified'::public.gender_type,
    blood_type public.blood_type DEFAULT 'unknown'::public.blood_type,
    address text,
    city character varying(100),
    province character varying(100),
    emergency_contact_name character varying(200),
    emergency_contact_phone character varying(20),
    insurance_provider character varying(200),
    insurance_number character varying(50),
    insurance_plan character varying(100),
    primary_doctor_id uuid,
    allergies text[],
    chronic_conditions text[],
    current_medications text[],
    notes text,
    is_active boolean DEFAULT true,
    sync_status character varying(20) DEFAULT 'synced'::character varying,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cuil character varying(13)
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    booking_request_id uuid,
    appointment_id uuid,
    patient_id uuid,
    amount numeric(10,2) NOT NULL,
    method character varying(20) NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status,
    proof_url text,
    reference character varying(100),
    payment_type character varying(30) DEFAULT 'deposit'::character varying,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: prescription_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescription_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    prescription_id uuid NOT NULL,
    medication_name character varying(255) NOT NULL,
    dosage character varying(100) NOT NULL,
    frequency character varying(200) NOT NULL,
    duration character varying(100),
    quantity integer,
    instructions text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    pharmaceutical_form character varying(100),
    presentation character varying(100),
    generic_name character varying(200)
);


--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    doctor_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    medical_record_id uuid,
    status public.prescription_status DEFAULT 'active'::public.prescription_status,
    diagnosis text NOT NULL,
    diagnosis_code character varying(10),
    issued_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    digital_signature text,
    verification_code character varying(20) DEFAULT upper(SUBSTRING(md5((random())::text) FROM 1 FOR 8)),
    notes text,
    sync_status character varying(20) DEFAULT 'synced'::character varying,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: provider_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_credentials (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    insurer_id uuid NOT NULL,
    provider_code character varying(60),
    provider_cuit character varying(13),
    username_enc bytea,
    password_enc bytea,
    extra_enc bytea,
    is_valid boolean DEFAULT true,
    last_verified_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: push_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    device_token_id uuid,
    recipient_type character varying(10) NOT NULL,
    recipient_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    body text NOT NULL,
    category character varying(50),
    data jsonb,
    status character varying(20) DEFAULT 'sent'::character varying,
    error_message text,
    sent_at timestamp with time zone DEFAULT now(),
    CONSTRAINT push_log_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'delivered'::character varying, 'failed'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_type character varying(20) NOT NULL,
    user_id uuid NOT NULL,
    platform character varying(10) NOT NULL,
    token text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT push_tokens_platform_check CHECK (((platform)::text = ANY ((ARRAY['ios'::character varying, 'android'::character varying])::text[])))
);


--
-- Name: schedule_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_exceptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    org_doctor_id uuid NOT NULL,
    date date NOT NULL,
    is_available boolean DEFAULT false,
    start_time time without time zone,
    end_time time without time zone,
    reason character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: secretaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.secretaries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone character varying(20),
    can_manage_appointments boolean DEFAULT true,
    can_view_medical_records boolean DEFAULT false,
    can_manage_patients boolean DEFAULT true,
    can_manage_billing boolean DEFAULT false,
    refresh_token_hash character varying(255),
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: slot_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_holds (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    org_doctor_id uuid NOT NULL,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    booking_request_id uuid,
    session_id character varying(100),
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: slot_release_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_release_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    waitlist_id uuid NOT NULL,
    org_doctor_id uuid NOT NULL,
    released_date date NOT NULL,
    released_start_time time without time zone NOT NULL,
    released_end_time time without time zone NOT NULL,
    cancelled_appointment_id uuid,
    notification_sent boolean DEFAULT false,
    sent_at timestamp with time zone,
    response character varying(20),
    responded_at timestamp with time zone,
    hold_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT slot_release_notifications_response_check CHECK (((response)::text = ANY ((ARRAY['accepted'::character varying, 'declined'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone character varying(20),
    dni character varying(20),
    license_number character varying(50),
    license_province character varying(100),
    specialty character varying(100),
    avatar_url text,
    refresh_token_hash character varying(255),
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscription_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    subscription_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    event_type character varying(40) NOT NULL,
    from_plan public.subscription_plan,
    to_plan public.subscription_plan,
    from_status public.subscription_status,
    to_status public.subscription_status,
    store public.store_type,
    store_transaction_id character varying(200),
    amount_usd numeric(6,2),
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    doctor_id uuid NOT NULL,
    plan public.subscription_plan DEFAULT 'free'::public.subscription_plan NOT NULL,
    status public.subscription_status DEFAULT 'active'::public.subscription_status NOT NULL,
    store public.store_type,
    store_product_id character varying(100),
    store_transaction_id character varying(200),
    store_original_transaction_id character varying(200),
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancelled_at timestamp with time zone,
    grace_period_end timestamp with time zone,
    price_usd numeric(6,2),
    currency character varying(3) DEFAULT 'USD'::character varying,
    is_trial boolean DEFAULT false,
    trial_end timestamp with time zone,
    raw_receipt jsonb,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: v_daily_agenda; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_daily_agenda AS
 SELECT a.id,
    a.organization_id,
    a.org_doctor_id,
    o.name AS org_name,
    o.type AS org_type,
    d.id AS doctor_id,
    (((d.first_name)::text || ' '::text) || (d.last_name)::text) AS doctor_name,
    d.specialty AS doctor_specialty,
    a.date,
    a.start_time,
    a.end_time,
    a.status,
    a.reason,
    a.is_first_visit,
    a.is_online,
    a.room_number,
    p.id AS patient_id,
    (((p.first_name)::text || ' '::text) || (p.last_name)::text) AS patient_name,
    p.phone AS patient_phone,
    p.insurance_provider,
    p.insurance_plan
   FROM ((((public.appointments a
     JOIN public.organization_doctors od ON ((od.id = a.org_doctor_id)))
     JOIN public.organizations o ON ((o.id = a.organization_id)))
     JOIN public.doctors d ON ((d.id = od.doctor_id)))
     JOIN public.patients p ON ((p.id = a.patient_id)))
  WHERE (a.status <> 'cancelled'::public.appointment_status)
  ORDER BY a.date, a.start_time;


--
-- Name: v_doctor_orgs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_doctor_orgs AS
 SELECT od.id AS org_doctor_id,
    od.doctor_id,
    od.role,
    od.is_owner,
    od.is_active,
    o.id AS org_id,
    o.name AS org_name,
    o.type AS org_type,
    o.address AS org_address,
    o.city AS org_city,
    o.phone AS org_phone,
    o.logo_url AS org_logo,
    ( SELECT count(*) AS count
           FROM public.patients p
          WHERE ((p.organization_id = o.id) AND p.is_active)) AS patient_count,
    ( SELECT count(*) AS count
           FROM public.organization_doctors od2
          WHERE ((od2.organization_id = o.id) AND od2.is_active)) AS doctor_count
   FROM (public.organization_doctors od
     JOIN public.organizations o ON ((o.id = od.organization_id)))
  WHERE (od.is_active = true);


--
-- Name: v_doctor_subscription; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_doctor_subscription AS
 SELECT d.id AS doctor_id,
    d.email,
    COALESCE(s.plan, 'free'::public.subscription_plan) AS plan,
    COALESCE(s.status, 'active'::public.subscription_status) AS subscription_status,
    s.id AS subscription_id,
    s.store,
    s.current_period_start,
    s.current_period_end,
    s.cancelled_at,
    s.grace_period_end,
    s.is_trial,
    s.trial_end,
        CASE
            WHEN ((s.plan = 'pro'::public.subscription_plan) AND (s.status = ANY (ARRAY['active'::public.subscription_status, 'grace_period'::public.subscription_status]))) THEN true
            ELSE false
        END AS is_pro,
        CASE
            WHEN ((s.plan = 'pro'::public.subscription_plan) AND (s.status = ANY (ARRAY['active'::public.subscription_status, 'grace_period'::public.subscription_status]))) THEN '-1'::integer
            ELSE 50
        END AS max_appointments_per_month,
        CASE
            WHEN ((s.plan = 'pro'::public.subscription_plan) AND (s.status = ANY (ARRAY['active'::public.subscription_status, 'grace_period'::public.subscription_status]))) THEN '-1'::integer
            ELSE 1
        END AS max_organizations
   FROM (public.doctors d
     LEFT JOIN public.subscriptions s ON (((s.doctor_id = d.id) AND (s.status = ANY (ARRAY['active'::public.subscription_status, 'grace_period'::public.subscription_status, 'billing_retry'::public.subscription_status])))))
  WHERE (d.is_active = true);


--
-- Name: v_hub_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_hub_coverage AS
SELECT
    NULL::uuid AS insurer_id,
    NULL::character varying(200) AS name,
    NULL::character varying(60) AS short_name,
    NULL::character varying(20) AS rnos_code,
    NULL::character varying(100) AS province,
    NULL::integer AS affiliate_count,
    NULL::bigint AS connector_count,
    NULL::boolean AS supports_validation,
    NULL::boolean AS supports_authorization,
    NULL::boolean AS supports_batch,
    NULL::integer AS best_priority,
    NULL::public.connector_kind AS primary_kind,
    NULL::public.connector_health AS primary_health;


--
-- Name: v_login_lookup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_login_lookup AS
 SELECT d.id AS user_id,
    d.email,
    d.password_hash,
    'doctor'::text AS user_type,
    d.first_name,
    d.last_name,
    (((d.first_name)::text || ' '::text) || (d.last_name)::text) AS full_name,
    d.specialty,
    d.medical_license,
    d.avatar_url,
    d.is_active,
    NULL::uuid AS patient_id,
    NULL::uuid AS staff_id
   FROM public.doctors d
  WHERE (d.is_active = true)
UNION ALL
 SELECT pa.id AS user_id,
    pa.email,
    pa.password_hash,
    'patient'::text AS user_type,
    p.first_name,
    p.last_name,
    (((p.first_name)::text || ' '::text) || (p.last_name)::text) AS full_name,
    NULL::character varying AS specialty,
    NULL::character varying AS medical_license,
    NULL::text AS avatar_url,
    true AS is_active,
    p.id AS patient_id,
    NULL::uuid AS staff_id
   FROM (public.patient_auth pa
     JOIN public.patients p ON ((p.id = pa.patient_id)))
  WHERE (pa.email IS NOT NULL)
UNION ALL
 SELECT s.id AS user_id,
    s.email,
    s.password_hash,
    'staff'::text AS user_type,
    s.first_name,
    s.last_name,
    (((s.first_name)::text || ' '::text) || (s.last_name)::text) AS full_name,
    s.specialty,
    s.license_number AS medical_license,
    s.avatar_url,
    s.is_active,
    NULL::uuid AS patient_id,
    s.id AS staff_id
   FROM public.staff s
  WHERE (s.is_active = true);


--
-- Name: v_org_doctors; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_org_doctors AS
 SELECT od.id AS org_doctor_id,
    od.organization_id,
    od.role,
    od.is_owner,
    od.consultation_fee,
    od.slot_duration_minutes,
    od.room_number,
    od.is_active,
    d.id AS doctor_id,
    d.first_name,
    d.last_name,
    (((d.first_name)::text || ' '::text) || (d.last_name)::text) AS full_name,
    d.medical_license,
    d.specialty,
    d.avatar_url,
    d.phone,
    d.email,
    o.name AS org_name,
    o.type AS org_type
   FROM ((public.organization_doctors od
     JOIN public.doctors d ON ((d.id = od.doctor_id)))
     JOIN public.organizations o ON ((o.id = od.organization_id)));


--
-- Name: v_public_doctor_profile; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_public_doctor_profile AS
 SELECT bs.public_slug,
    bs.is_enabled,
    bs.booking_mode,
    bs.requires_deposit,
    bs.deposit_amount,
    bs.consultation_fee,
    bs.payment_methods,
    bs.bank_name,
    bs.bank_account_holder,
    bs.bank_cbu,
    bs.bank_alias,
    bs.payment_deadline_minutes,
    bs.min_hours_before_cancel,
    bs.max_days_in_advance,
    bs.min_hours_in_advance,
    bs.allow_new_patients,
    bs.requires_insurance_info,
    bs.welcome_message,
    bs.instructions,
    bs.cancellation_policy_text,
    od.id AS org_doctor_id,
    d.id AS doctor_id,
    (((d.first_name)::text || ' '::text) || (d.last_name)::text) AS doctor_name,
    d.specialty,
    d.avatar_url,
    d.medical_license,
    o.id AS organization_id,
    o.name AS org_name,
    o.type AS org_type,
    o.address,
    o.city,
    o.province,
    o.phone AS org_phone,
    o.logo_url,
    o.primary_color
   FROM (((public.booking_settings bs
     JOIN public.organization_doctors od ON ((od.id = bs.org_doctor_id)))
     JOIN public.doctors d ON ((d.id = od.doctor_id)))
     JOIN public.organizations o ON ((o.id = od.organization_id)))
  WHERE ((bs.is_enabled = true) AND (od.is_active = true));


--
-- Name: waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    org_doctor_id uuid NOT NULL,
    patient_id uuid,
    contact_name character varying(200),
    contact_phone character varying(30),
    contact_email character varying(255),
    desired_date date NOT NULL,
    preferred_start_time time without time zone,
    preferred_end_time time without time zone,
    reason text,
    status character varying(20) DEFAULT 'waiting'::character varying,
    notified_at timestamp with time zone,
    notified_slot_time time without time zone,
    booked_appointment_id uuid,
    priority smallint DEFAULT 50,
    notes text,
    notify_push boolean DEFAULT true,
    notify_sms boolean DEFAULT false,
    notify_email boolean DEFAULT false,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT waitlist_status_check CHECK (((status)::text = ANY ((ARRAY['waiting'::character varying, 'notified'::character varying, 'booked'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: access_logs access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_logs
    ADD CONSTRAINT access_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_sessions admin_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_pkey PRIMARY KEY (id);


--
-- Name: admin_sessions admin_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_token_key UNIQUE (token);


--
-- Name: affiliate_cache affiliate_cache_insurer_id_affiliate_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_cache
    ADD CONSTRAINT affiliate_cache_insurer_id_affiliate_number_key UNIQUE (insurer_id, affiliate_number);


--
-- Name: affiliate_cache affiliate_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_cache
    ADD CONSTRAINT affiliate_cache_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: billing_batches billing_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_pkey PRIMARY KEY (id);


--
-- Name: billing_items billing_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_items
    ADD CONSTRAINT billing_items_pkey PRIMARY KEY (id);


--
-- Name: booking_requests booking_requests_confirmation_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_confirmation_token_key UNIQUE (confirmation_token);


--
-- Name: booking_requests booking_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_pkey PRIMARY KEY (id);


--
-- Name: booking_settings booking_settings_org_doctor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_org_doctor_id_key UNIQUE (org_doctor_id);


--
-- Name: booking_settings booking_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_pkey PRIMARY KEY (id);


--
-- Name: booking_settings booking_settings_public_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_public_slug_key UNIQUE (public_slug);


--
-- Name: chatbot_config chatbot_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_config
    ADD CONSTRAINT chatbot_config_pkey PRIMARY KEY (id);


--
-- Name: chatbot_faqs chatbot_faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_faqs
    ADD CONSTRAINT chatbot_faqs_pkey PRIMARY KEY (id);


--
-- Name: connectors connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connectors
    ADD CONSTRAINT connectors_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: doctor_reminder_settings doctor_reminder_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_reminder_settings
    ADD CONSTRAINT doctor_reminder_settings_pkey PRIMARY KEY (id);


--
-- Name: doctor_schedules doctor_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_pkey PRIMARY KEY (id);


--
-- Name: doctors doctors_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_email_key UNIQUE (email);


--
-- Name: doctors doctors_medical_license_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_medical_license_key UNIQUE (medical_license);


--
-- Name: doctors doctors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_pkey PRIMARY KEY (id);


--
-- Name: feature_usage feature_usage_doctor_id_period_year_period_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_usage
    ADD CONSTRAINT feature_usage_doctor_id_period_year_period_month_key UNIQUE (doctor_id, period_year, period_month);


--
-- Name: feature_usage feature_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_usage
    ADD CONSTRAINT feature_usage_pkey PRIMARY KEY (id);


--
-- Name: hub_requests hub_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_requests
    ADD CONSTRAINT hub_requests_pkey PRIMARY KEY (id);


--
-- Name: informed_consents informed_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.informed_consents
    ADD CONSTRAINT informed_consents_pkey PRIMARY KEY (id);


--
-- Name: insurer_plans insurer_plans_insurer_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurer_plans
    ADD CONSTRAINT insurer_plans_insurer_id_code_key UNIQUE (insurer_id, code);


--
-- Name: insurer_plans insurer_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurer_plans
    ADD CONSTRAINT insurer_plans_pkey PRIMARY KEY (id);


--
-- Name: insurers insurers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurers
    ADD CONSTRAINT insurers_pkey PRIMARY KEY (id);


--
-- Name: insurers insurers_rnos_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurers
    ADD CONSTRAINT insurers_rnos_code_key UNIQUE (rnos_code);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: medical_records medical_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: nomenclator_items nomenclator_items_nomenclator_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nomenclator_items
    ADD CONSTRAINT nomenclator_items_nomenclator_id_code_key UNIQUE (nomenclator_id, code);


--
-- Name: nomenclator_items nomenclator_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nomenclator_items
    ADD CONSTRAINT nomenclator_items_pkey PRIMARY KEY (id);


--
-- Name: nomenclators nomenclators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nomenclators
    ADD CONSTRAINT nomenclators_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_doctors organization_doctors_organization_id_doctor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_doctors
    ADD CONSTRAINT organization_doctors_organization_id_doctor_id_key UNIQUE (organization_id, doctor_id);


--
-- Name: organization_doctors organization_doctors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_doctors
    ADD CONSTRAINT organization_doctors_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: patient_auth patient_auth_patient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_auth
    ADD CONSTRAINT patient_auth_patient_id_key UNIQUE (patient_id);


--
-- Name: patient_auth patient_auth_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_auth
    ADD CONSTRAINT patient_auth_pkey PRIMARY KEY (id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: prescription_items prescription_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_verification_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_verification_code_key UNIQUE (verification_code);


--
-- Name: provider_credentials provider_credentials_organization_id_insurer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_organization_id_insurer_id_key UNIQUE (organization_id, insurer_id);


--
-- Name: provider_credentials provider_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_pkey PRIMARY KEY (id);


--
-- Name: push_log push_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_log
    ADD CONSTRAINT push_log_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: schedule_exceptions schedule_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_exceptions
    ADD CONSTRAINT schedule_exceptions_pkey PRIMARY KEY (id);


--
-- Name: secretaries secretaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.secretaries
    ADD CONSTRAINT secretaries_pkey PRIMARY KEY (id);


--
-- Name: slot_holds slot_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_holds
    ADD CONSTRAINT slot_holds_pkey PRIMARY KEY (id);


--
-- Name: slot_release_notifications slot_release_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_release_notifications
    ADD CONSTRAINT slot_release_notifications_pkey PRIMARY KEY (id);


--
-- Name: staff staff_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_email_key UNIQUE (email);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: subscription_events subscription_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_store_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_store_transaction_id_key UNIQUE (store_transaction_id);


--
-- Name: chatbot_config uq_chatbot_doctor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_config
    ADD CONSTRAINT uq_chatbot_doctor UNIQUE (org_doctor_id);


--
-- Name: device_tokens uq_device_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT uq_device_token UNIQUE (token);


--
-- Name: doctor_reminder_settings uq_doctor_reminder_settings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_reminder_settings
    ADD CONSTRAINT uq_doctor_reminder_settings UNIQUE (doctor_id);


--
-- Name: waitlist waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);


--
-- Name: idx_access_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_action ON public.access_logs USING btree (action);


--
-- Name: idx_access_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_created_at ON public.access_logs USING btree (created_at);


--
-- Name: idx_access_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_user_id ON public.access_logs USING btree (user_id);


--
-- Name: idx_admin_sessions_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_sessions_exp ON public.admin_sessions USING btree (expires_at);


--
-- Name: idx_admin_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_sessions_token ON public.admin_sessions USING btree (token);


--
-- Name: idx_affiliate_cache_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_cache_doc ON public.affiliate_cache USING btree (insurer_id, document_number);


--
-- Name: idx_affiliate_cache_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_cache_exp ON public.affiliate_cache USING btree (expires_at);


--
-- Name: idx_affiliate_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_cache_lookup ON public.affiliate_cache USING btree (insurer_id, affiliate_number);


--
-- Name: idx_appt_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appt_org_date ON public.appointments USING btree (organization_id, date);


--
-- Name: idx_appt_orgdoc_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appt_orgdoc_date ON public.appointments USING btree (org_doctor_id, date);


--
-- Name: idx_appt_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appt_patient ON public.appointments USING btree (patient_id);


--
-- Name: idx_appt_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appt_status ON public.appointments USING btree (status);


--
-- Name: idx_audit_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_doctor ON public.audit_logs USING btree (doctor_id, created_at DESC);


--
-- Name: idx_audit_log_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_changed_at ON public.audit_log USING btree (changed_at);


--
-- Name: idx_audit_log_changed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_changed_by ON public.audit_log USING btree (changed_by);


--
-- Name: idx_audit_log_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_table_record ON public.audit_log USING btree (table_name, record_id);


--
-- Name: idx_audit_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_org ON public.audit_logs USING btree (organization_id, created_at DESC);


--
-- Name: idx_batches_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batches_org ON public.billing_batches USING btree (organization_id, period_year DESC, period_month DESC);


--
-- Name: idx_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batches_status ON public.billing_batches USING btree (status);


--
-- Name: idx_billing_items_audit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_items_audit ON public.billing_items USING btree (batch_id, audit_status);


--
-- Name: idx_billing_items_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_items_batch ON public.billing_items USING btree (batch_id);


--
-- Name: idx_booking_req_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_req_date ON public.booking_requests USING btree (requested_date);


--
-- Name: idx_booking_req_orgdoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_req_orgdoc ON public.booking_requests USING btree (org_doctor_id, status);


--
-- Name: idx_booking_req_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_req_pending ON public.booking_requests USING btree (org_doctor_id) WHERE (status = ANY (ARRAY['pending_payment'::public.booking_status, 'pending_approval'::public.booking_status]));


--
-- Name: idx_booking_req_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_req_phone ON public.booking_requests USING btree (phone);


--
-- Name: idx_booking_req_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_req_token ON public.booking_requests USING btree (confirmation_token);


--
-- Name: idx_booking_settings_orgdoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_settings_orgdoc ON public.booking_settings USING btree (org_doctor_id);


--
-- Name: idx_booking_settings_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_settings_slug ON public.booking_settings USING btree (public_slug) WHERE (is_enabled = true);


--
-- Name: idx_chatbot_config_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chatbot_config_doctor ON public.chatbot_config USING btree (org_doctor_id);


--
-- Name: idx_chatbot_faqs_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chatbot_faqs_config ON public.chatbot_faqs USING btree (chatbot_config_id);


--
-- Name: idx_connectors_health; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connectors_health ON public.connectors USING btree (health);


--
-- Name: idx_connectors_insurer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connectors_insurer ON public.connectors USING btree (insurer_id, priority) WHERE is_enabled;


--
-- Name: idx_consents_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consents_doctor ON public.informed_consents USING btree (doctor_id);


--
-- Name: idx_consents_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consents_org ON public.informed_consents USING btree (organization_id);


--
-- Name: idx_consents_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consents_patient ON public.informed_consents USING btree (patient_id);


--
-- Name: idx_consents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consents_type ON public.informed_consents USING btree (consent_type);


--
-- Name: idx_conv_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_doctor ON public.conversations USING btree (doctor_id, last_message_at DESC);


--
-- Name: idx_conv_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_conv_unique ON public.conversations USING btree (organization_id, doctor_id, patient_id);


--
-- Name: idx_doctors_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_email ON public.doctors USING btree (email);


--
-- Name: idx_doctors_license; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_license ON public.doctors USING btree (medical_license);


--
-- Name: idx_doctors_platform_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_platform_admin ON public.doctors USING btree (is_platform_admin) WHERE is_platform_admin;


--
-- Name: idx_exceptions_orgdoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exceptions_orgdoc ON public.schedule_exceptions USING btree (org_doctor_id, date);


--
-- Name: idx_feature_usage_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_usage_doctor ON public.feature_usage USING btree (doctor_id, period_year DESC, period_month DESC);


--
-- Name: idx_hub_req_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_hub_req_idem ON public.hub_requests USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_hub_req_insurer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_req_insurer ON public.hub_requests USING btree (insurer_id, created_at DESC);


--
-- Name: idx_hub_req_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_req_org ON public.hub_requests USING btree (organization_id, created_at DESC);


--
-- Name: idx_hub_req_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_req_pending ON public.hub_requests USING btree (operation) WHERE (result = 'pending'::public.validation_result);


--
-- Name: idx_insurers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insurers_name ON public.insurers USING gin (to_tsvector('spanish'::regconfig, (name)::text));


--
-- Name: idx_insurers_province; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insurers_province ON public.insurers USING btree (province) WHERE is_active;


--
-- Name: idx_insurers_rnos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insurers_rnos ON public.insurers USING btree (rnos_code);


--
-- Name: idx_invitations_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_email ON public.invitations USING btree (invited_email, status);


--
-- Name: idx_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_token ON public.invitations USING btree (token);


--
-- Name: idx_msg_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_conv ON public.messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_msg_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_unread ON public.messages USING btree (conversation_id, is_read) WHERE (is_read = false);


--
-- Name: idx_nom_items_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nom_items_code ON public.nomenclator_items USING btree (nomenclator_id, code);


--
-- Name: idx_nom_items_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nom_items_search ON public.nomenclator_items USING gin (to_tsvector('spanish'::regconfig, description));


--
-- Name: idx_nomenclators_active_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nomenclators_active_period ON public.nomenclators USING btree (insurer_id, valid_from DESC) WHERE is_active;


--
-- Name: idx_nomenclators_insurer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nomenclators_insurer ON public.nomenclators USING btree (insurer_id, valid_from DESC);


--
-- Name: idx_nomenclators_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nomenclators_org ON public.nomenclators USING btree (organization_id);


--
-- Name: idx_notif_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_recipient ON public.notifications USING btree (recipient_type, recipient_id, created_at DESC);


--
-- Name: idx_org_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_city ON public.organizations USING btree (city, province);


--
-- Name: idx_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_type ON public.organizations USING btree (type);


--
-- Name: idx_orgdoc_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgdoc_active ON public.organization_doctors USING btree (organization_id, is_active) WHERE (is_active = true);


--
-- Name: idx_orgdoc_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgdoc_doctor ON public.organization_doctors USING btree (doctor_id);


--
-- Name: idx_orgdoc_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgdoc_org ON public.organization_doctors USING btree (organization_id);


--
-- Name: idx_patient_auth_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_auth_patient ON public.patient_auth USING btree (patient_id);


--
-- Name: idx_patient_auth_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_auth_phone ON public.patient_auth USING btree (phone);


--
-- Name: idx_patients_dni; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_dni ON public.patients USING btree (organization_id, dni);


--
-- Name: idx_patients_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_doctor ON public.patients USING btree (primary_doctor_id);


--
-- Name: idx_patients_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_name ON public.patients USING btree (organization_id, last_name, first_name);


--
-- Name: idx_patients_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_org ON public.patients USING btree (organization_id);


--
-- Name: idx_payments_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking ON public.payments USING btree (booking_request_id);


--
-- Name: idx_payments_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_org ON public.payments USING btree (organization_id, created_at DESC);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_plans_insurer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_insurer ON public.insurer_plans USING btree (insurer_id);


--
-- Name: idx_prescriptions_verification_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prescriptions_verification_code ON public.prescriptions USING btree (verification_code);


--
-- Name: idx_provider_creds_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_creds_org ON public.provider_credentials USING btree (organization_id);


--
-- Name: idx_push_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_push_unique ON public.push_tokens USING btree (user_type, user_id, platform, token);


--
-- Name: idx_records_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_records_doctor ON public.medical_records USING btree (doctor_id);


--
-- Name: idx_records_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_records_org ON public.medical_records USING btree (organization_id);


--
-- Name: idx_records_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_records_patient ON public.medical_records USING btree (patient_id, date DESC);


--
-- Name: idx_reminder_settings_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminder_settings_doctor ON public.doctor_reminder_settings USING btree (doctor_id);


--
-- Name: idx_rx_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rx_doctor ON public.prescriptions USING btree (doctor_id);


--
-- Name: idx_rx_items; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rx_items ON public.prescription_items USING btree (prescription_id);


--
-- Name: idx_rx_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rx_org ON public.prescriptions USING btree (organization_id);


--
-- Name: idx_rx_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rx_patient ON public.prescriptions USING btree (patient_id);


--
-- Name: idx_rx_verification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rx_verification ON public.prescriptions USING btree (verification_code);


--
-- Name: idx_schedule_orgdoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_orgdoc ON public.doctor_schedules USING btree (org_doctor_id);


--
-- Name: idx_schedule_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_schedule_unique ON public.doctor_schedules USING btree (org_doctor_id, day_of_week) WHERE (is_active = true);


--
-- Name: idx_secretaries_email_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_secretaries_email_org ON public.secretaries USING btree (organization_id, email);


--
-- Name: idx_secretaries_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_secretaries_org ON public.secretaries USING btree (organization_id);


--
-- Name: idx_slot_holds; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slot_holds ON public.slot_holds USING btree (org_doctor_id, date, start_time);


--
-- Name: idx_slot_holds_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slot_holds_expiry ON public.slot_holds USING btree (expires_at);


--
-- Name: idx_slot_release_waitlist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slot_release_waitlist ON public.slot_release_notifications USING btree (waitlist_id);


--
-- Name: idx_sub_events_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_events_doctor ON public.subscription_events USING btree (doctor_id, created_at DESC);


--
-- Name: idx_sub_events_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_events_sub ON public.subscription_events USING btree (subscription_id, created_at DESC);


--
-- Name: idx_sub_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_events_type ON public.subscription_events USING btree (event_type, created_at DESC);


--
-- Name: idx_subscriptions_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_doctor ON public.subscriptions USING btree (doctor_id);


--
-- Name: idx_subscriptions_doctor_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_doctor_active ON public.subscriptions USING btree (doctor_id) WHERE (status = ANY (ARRAY['active'::public.subscription_status, 'grace_period'::public.subscription_status, 'billing_retry'::public.subscription_status]));


--
-- Name: idx_subscriptions_expiring; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_expiring ON public.subscriptions USING btree (current_period_end) WHERE ((status = 'active'::public.subscription_status) AND (plan = 'pro'::public.subscription_plan));


--
-- Name: idx_subscriptions_original_txn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_original_txn ON public.subscriptions USING btree (store_original_transaction_id);


--
-- Name: idx_subscriptions_store_txn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_store_txn ON public.subscriptions USING btree (store_transaction_id);


--
-- Name: idx_waitlist_doctor_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_doctor_date ON public.waitlist USING btree (org_doctor_id, desired_date) WHERE ((status)::text = 'waiting'::text);


--
-- Name: idx_waitlist_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_org ON public.waitlist USING btree (organization_id);


--
-- Name: idx_waitlist_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_patient ON public.waitlist USING btree (patient_id) WHERE (patient_id IS NOT NULL);


--
-- Name: idx_waitlist_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_status ON public.waitlist USING btree (status, desired_date);


--
-- Name: v_hub_coverage _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_hub_coverage AS
 SELECT i.id AS insurer_id,
    i.name,
    i.short_name,
    i.rnos_code,
    i.province,
    i.affiliate_count,
    count(c.id) FILTER (WHERE c.is_enabled) AS connector_count,
    bool_or((c.can_validate_affiliate AND c.is_enabled)) AS supports_validation,
    bool_or((c.can_authorize_practice AND c.is_enabled)) AS supports_authorization,
    bool_or((c.can_submit_batch AND c.is_enabled)) AS supports_batch,
    min(c.priority) FILTER (WHERE c.is_enabled) AS best_priority,
    (array_agg(c.kind ORDER BY c.priority) FILTER (WHERE c.is_enabled))[1] AS primary_kind,
    (array_agg(c.health ORDER BY c.priority) FILTER (WHERE c.is_enabled))[1] AS primary_health
   FROM (public.insurers i
     LEFT JOIN public.connectors c ON ((c.insurer_id = i.id)))
  WHERE i.is_active
  GROUP BY i.id;


--
-- Name: appointments trg_appt_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_appt_upd BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: appointments trg_audit_appointments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_appointments AFTER UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.fn_audit_appointments();


--
-- Name: informed_consents trg_audit_consents; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_consents AFTER INSERT OR UPDATE ON public.informed_consents FOR EACH ROW EXECUTE FUNCTION public.fn_audit_consents();


--
-- Name: medical_records trg_audit_medical_records; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_medical_records AFTER INSERT OR DELETE OR UPDATE ON public.medical_records FOR EACH ROW EXECUTE FUNCTION public.fn_audit_medical_records();


--
-- Name: billing_batches trg_batches_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_batches_upd BEFORE UPDATE ON public.billing_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: booking_requests trg_booking_req_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_booking_req_upd BEFORE UPDATE ON public.booking_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: booking_settings trg_booking_settings_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_booking_settings_upd BEFORE UPDATE ON public.booking_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: chatbot_config trg_chatbot_config_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chatbot_config_upd BEFORE UPDATE ON public.chatbot_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: connectors trg_connectors_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connectors_upd BEFORE UPDATE ON public.connectors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: conversations trg_conv_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_conv_upd BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: doctors trg_doctors_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_doctors_upd BEFORE UPDATE ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: insurers trg_insurers_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_insurers_upd BEFORE UPDATE ON public.insurers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: organization_doctors trg_orgdoc_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orgdoc_upd BEFORE UPDATE ON public.organization_doctors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: organizations trg_orgs_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orgs_upd BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: patient_auth trg_patient_auth_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patient_auth_upd BEFORE UPDATE ON public.patient_auth FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: patients trg_patients_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patients_upd BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: payments trg_payments_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payments_upd BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: provider_credentials trg_provider_creds_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_provider_creds_upd BEFORE UPDATE ON public.provider_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: medical_records trg_records_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_records_upd BEFORE UPDATE ON public.medical_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: prescriptions trg_rx_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rx_upd BEFORE UPDATE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: subscriptions trg_subscriptions_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscriptions_upd BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: waitlist trg_waitlist_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_waitlist_upd BEFORE UPDATE ON public.waitlist FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: admin_sessions admin_sessions_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: affiliate_cache affiliate_cache_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_cache
    ADD CONSTRAINT affiliate_cache_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id);


--
-- Name: appointments appointments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: appointments appointments_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: audit_logs audit_logs_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: audit_logs audit_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: billing_batches billing_batches_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id);


--
-- Name: billing_batches billing_batches_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: billing_items billing_items_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_items
    ADD CONSTRAINT billing_items_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: billing_items billing_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_items
    ADD CONSTRAINT billing_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.billing_batches(id) ON DELETE CASCADE;


--
-- Name: billing_items billing_items_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_items
    ADD CONSTRAINT billing_items_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: billing_items billing_items_medical_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_items
    ADD CONSTRAINT billing_items_medical_record_id_fkey FOREIGN KEY (medical_record_id) REFERENCES public.medical_records(id);


--
-- Name: billing_items billing_items_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_items
    ADD CONSTRAINT billing_items_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: booking_requests booking_requests_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: booking_requests booking_requests_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: booking_requests booking_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: booking_requests booking_requests_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: booking_requests booking_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_requests
    ADD CONSTRAINT booking_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.doctors(id);


--
-- Name: booking_settings booking_settings_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: chatbot_config chatbot_config_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_config
    ADD CONSTRAINT chatbot_config_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: chatbot_faqs chatbot_faqs_chatbot_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_faqs
    ADD CONSTRAINT chatbot_faqs_chatbot_config_id_fkey FOREIGN KEY (chatbot_config_id) REFERENCES public.chatbot_config(id) ON DELETE CASCADE;


--
-- Name: connectors connectors_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connectors
    ADD CONSTRAINT connectors_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: conversations conversations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: conversations conversations_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: device_tokens device_tokens_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: device_tokens device_tokens_patient_auth_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_patient_auth_id_fkey FOREIGN KEY (patient_auth_id) REFERENCES public.patient_auth(id) ON DELETE CASCADE;


--
-- Name: device_tokens device_tokens_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: doctor_reminder_settings doctor_reminder_settings_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_reminder_settings
    ADD CONSTRAINT doctor_reminder_settings_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: doctor_schedules doctor_schedules_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: feature_usage feature_usage_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_usage
    ADD CONSTRAINT feature_usage_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: hub_requests hub_requests_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_requests
    ADD CONSTRAINT hub_requests_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: hub_requests hub_requests_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_requests
    ADD CONSTRAINT hub_requests_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES public.connectors(id);


--
-- Name: hub_requests hub_requests_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_requests
    ADD CONSTRAINT hub_requests_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id);


--
-- Name: hub_requests hub_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_requests
    ADD CONSTRAINT hub_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: hub_requests hub_requests_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_requests
    ADD CONSTRAINT hub_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: informed_consents informed_consents_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.informed_consents
    ADD CONSTRAINT informed_consents_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: informed_consents informed_consents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.informed_consents
    ADD CONSTRAINT informed_consents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: informed_consents informed_consents_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.informed_consents
    ADD CONSTRAINT informed_consents_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: insurer_plans insurer_plans_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurer_plans
    ADD CONSTRAINT insurer_plans_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.doctors(id);


--
-- Name: invitations invitations_invited_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_doctor_id_fkey FOREIGN KEY (invited_doctor_id) REFERENCES public.doctors(id);


--
-- Name: invitations invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: medical_records medical_records_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: medical_records medical_records_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: medical_records medical_records_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: medical_records medical_records_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: messages messages_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_prescription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id);


--
-- Name: nomenclator_items nomenclator_items_nomenclator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nomenclator_items
    ADD CONSTRAINT nomenclator_items_nomenclator_id_fkey FOREIGN KEY (nomenclator_id) REFERENCES public.nomenclators(id) ON DELETE CASCADE;


--
-- Name: nomenclators nomenclators_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nomenclators
    ADD CONSTRAINT nomenclators_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id) ON DELETE CASCADE;


--
-- Name: nomenclators nomenclators_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nomenclators
    ADD CONSTRAINT nomenclators_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organization_doctors organization_doctors_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_doctors
    ADD CONSTRAINT organization_doctors_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: organization_doctors organization_doctors_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_doctors
    ADD CONSTRAINT organization_doctors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: patient_auth patient_auth_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_auth
    ADD CONSTRAINT patient_auth_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: patients patients_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: patients patients_primary_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_primary_doctor_id_fkey FOREIGN KEY (primary_doctor_id) REFERENCES public.doctors(id);


--
-- Name: patients patients_referred_from_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_referred_from_org_id_fkey FOREIGN KEY (referred_from_org_id) REFERENCES public.organizations(id);


--
-- Name: payments payments_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: payments payments_booking_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id);


--
-- Name: payments payments_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.doctors(id);


--
-- Name: payments payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: payments payments_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: prescription_items prescription_items_prescription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id) ON DELETE CASCADE;


--
-- Name: prescriptions prescriptions_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: prescriptions prescriptions_medical_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_medical_record_id_fkey FOREIGN KEY (medical_record_id) REFERENCES public.medical_records(id);


--
-- Name: prescriptions prescriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: prescriptions prescriptions_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: provider_credentials provider_credentials_insurer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_insurer_id_fkey FOREIGN KEY (insurer_id) REFERENCES public.insurers(id) ON DELETE CASCADE;


--
-- Name: provider_credentials provider_credentials_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: push_log push_log_device_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_log
    ADD CONSTRAINT push_log_device_token_id_fkey FOREIGN KEY (device_token_id) REFERENCES public.device_tokens(id) ON DELETE SET NULL;


--
-- Name: schedule_exceptions schedule_exceptions_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_exceptions
    ADD CONSTRAINT schedule_exceptions_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: secretaries secretaries_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.secretaries
    ADD CONSTRAINT secretaries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: slot_holds slot_holds_booking_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_holds
    ADD CONSTRAINT slot_holds_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE CASCADE;


--
-- Name: slot_holds slot_holds_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_holds
    ADD CONSTRAINT slot_holds_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: slot_release_notifications slot_release_notifications_cancelled_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_release_notifications
    ADD CONSTRAINT slot_release_notifications_cancelled_appointment_id_fkey FOREIGN KEY (cancelled_appointment_id) REFERENCES public.appointments(id);


--
-- Name: slot_release_notifications slot_release_notifications_waitlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_release_notifications
    ADD CONSTRAINT slot_release_notifications_waitlist_id_fkey FOREIGN KEY (waitlist_id) REFERENCES public.waitlist(id) ON DELETE CASCADE;


--
-- Name: subscription_events subscription_events_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: subscription_events subscription_events_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: waitlist waitlist_booked_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_booked_appointment_id_fkey FOREIGN KEY (booked_appointment_id) REFERENCES public.appointments(id);


--
-- Name: waitlist waitlist_org_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_org_doctor_id_fkey FOREIGN KEY (org_doctor_id) REFERENCES public.organization_doctors(id) ON DELETE CASCADE;


--
-- Name: waitlist waitlist_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: waitlist waitlist_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict QqBcPuItzsH4kq01do2iI6Ri1yrn4VaGvVOQ2ON1x6NptlAWsIycCcb6jRmWyJH

