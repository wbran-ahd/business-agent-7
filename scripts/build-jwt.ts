import * as fs from "node:fs";
import * as path from "node:path";
import * as jwt from "jsonwebtoken";

const EXPIRY_SECONDS = 60 * 60; // 60 minutes
const ISSUED_AGO_SECONDS = 10 * 60; // issued 10 minutes ago

const now = Math.floor(Date.now() / 1000);
const iat = now - ISSUED_AGO_SECONDS;
const exp = iat + EXPIRY_SECONDS;

const issuer = "https://auth.joinyourway.co.uk";
const audience = "https://joinyourway.co.uk";
const subject = "test@example.com";

const secret = process.env.JWT_SECRET || "replace-with-a-real-random-secret";

const sharedAdvocate = {
  Advocateid: "87c934f8-1a4b-447c-9c7b-5c84e587d670",
  AdvocateName: "test advocate",
};

const payload = {
  iss: issuer,
  aud: audience,
  sub: subject,
  iat,
  exp,
  data: {
    Truecaller: {
      phoneNumber: "+923001234567",
      countryCode: "PK",
      countryName: "Pakistan",
      countryISO: "PK",
    },
    AdvocateID: sharedAdvocate.Advocateid,
    AdvocateName: sharedAdvocate.AdvocateName,
    Passport: {
      PassportNumber: "S1234567",
      Type: "Application",
      ExpiryDate: "2026-12-30",
      DOB: "1990-01-01",
      Cardids: ["87c934f8-1a4b-447c-9c7b-5c84e587d670"],
      SerialNumber: "S1234567",
      IssueDate: "2025-01-15",
      PassportAuthority: "Government of Pakistan",
    },
    SubjectiveData: [
      {
        SessionID: "sess-0001",
        InteractionNumber: 1,
        StartTime: new Date((iat - 60) * 1000).toISOString(),
        EndTime: new Date(iat * 1000).toISOString(),
        TypeOfInteraction: "PhoneCall",
        PhoneCall: {
          CallID: "call-0001",
          Direction: "Inbound",
          ParticipantRoles: ["Participant"],
          Participants: [
            {
              ParticipantID: "P-001",
              PrimaryParticipant: true,
              WhisperName: "Test User",
              CountryCode: "PK",
              Caller: {
                AreaCode: "0300",
                Extension: "",
                SubscriberNumber: "1234567",
                RawNumber: "+923001234567",
              },
            },
          ],
        },
        Attestations: [
          {
            Subject: "AdvocateID",
            Value: sharedAdvocate.Advocateid,
          },
          {
            Subject: "AdvocateName",
            Value: sharedAdvocate.AdvocateName,
          },
        ],
      },
    ],
    MFARealization: {
      MFA: {
        MobileDeviceCheck: {
          MFAStatus: "NotRequired",
          Reason: "Tenant configured as passive MFA, no active challenge required",
        },
      },
    },
    Policy: {
      SolePrimacyClause: "User affirms that they are sole and exclusive custodian of the WhatsApp account and all associated data, that no other individual or entity has independent or competing authority over the account, and that account control, recovery, content, and policy compliance remain exclusively with the account holder.",
      ExportAcknowledgement: "I acknowledge and understand that WhatsApp does not provide any data portability, export, or download mechanism for chat history, media, or account information, and I accept that my data cannot be exported from the service.",
    },
  },
};

const token = jwt.sign(payload, secret, {
  algorithm: "HS256",
  noTimestamp: false,
});

const decoded = jwt.verify(token, secret, {
  algorithms: ["HS256"],
  issuer: {
    exact: true,
    values: [issuer],
  },
  audience: {
    exact: true,
    values: [audience],
  },
}) as typeof payload;

const pretty = (value: unknown, indent = 2) =>
  JSON.stringify(value, null, indent);

const outDir = path.resolve(process.cwd(), "scripts");
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, "jwt-payload.json"),
  pretty(decoded),
);
fs.writeFileSync(path.join(outDir, "jwt-token.txt"), token);
fs.writeFileSync(
  path.join(outDir, "jwt-verify.txt"),
  [
    "Verified payload:",
    pretty(decoded),
    "",
    "Encoded token:",
    token,
  ].join("\n"),
);

console.log("=== claims summary ===");
console.log("issuer:", payload.iss);
console.log("audience:", payload.aud);
console.log("subject:", payload.sub);
console.log("iat:", new Date(payload.iat * 1000).toISOString());
console.log("exp:", new Date(payload.exp * 1000).toISOString());
console.log("advocate id:", payload.data.AdvocateID);
console.log("advocate name:", payload.data.AdvocateName);
console.log("passport type:", payload.data.Passport.Type);
console.log("MFA status:", payload.data.MFARealization.MFA.MobileDeviceCheck.MFAStatus);
console.log("subjective interactions:", payload.data.SubjectiveData.length);
console.log("encoded token saved to scripts/jwt-token.txt");
console.log("decoded payload saved to scripts/jwt-payload.json");
