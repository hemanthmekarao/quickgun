#!/usr/bin/env node
/**
 * Creates a DEMO household with realistic sample data by calling the public API,
 * exactly as a client would. For demo and development environments only: every figure
 * here is invented, and payments are recorded as self-reported, never as verified.
 *
 *   node apps/api/scripts/seed-demo.mjs --api http://localhost:4000 --email demo@example.com --password 'Demo-password-1'
 *
 * Prints a JSON summary (ids of the main records) on the last line.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { HomeOSClient } = require(join(here, '../../../packages/shared/dist/index.js'));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const apiBase = (args.api ?? process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const email = args.email ?? `demo.${Date.now().toString(36)}@example.com`;
const password = args.password ?? 'Demo-password-1';

if (process.env.NODE_ENV === 'production' && args.force !== 'true') {
  console.error('Refusing to seed demo data in production. Pass --force true if this really is a demo environment.');
  process.exit(1);
}

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const month = (offset) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
};

const client = new HomeOSClient({ baseUrl: `${apiBase}/v1` });

// The API is rate limited; wait and retry instead of failing half-way through.
const rawRequest = client.request.bind(client);
client.request = async (...a) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawRequest(...a);
    } catch (err) {
      if (err?.status !== 429 || attempt >= 8) throw err;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
};

async function main() {
  let session;
  try {
    session = await client.register({ email, password, name: 'Asha Rao', householdName: 'Rao Residence (demo)' });
  } catch (err) {
    if (err.status !== 409) throw err;
    session = await client.login(email, password);
  }
  const household = session.households[0];
  client.setHousehold(household.id);
  const make = (key, data) => client.resource(key).create(data);

  const existing = await client.resource('properties').list({ pageSize: 1 });
  if (existing.total > 0) {
    console.error('This household already has data; nothing was added.');
    console.log(JSON.stringify({ email, householdId: household.id, skipped: true }));
    return;
  }

  /* People */
  const spouse = await client.post('/members', { name: 'Vikram Rao', relationship: 'Spouse', roleKey: 'SPOUSE', bloodGroup: 'B+' });
  const child = await client.post('/members', { name: 'Meera Rao', relationship: 'Daughter', roleKey: 'FAMILY_MEMBER', dateOfBirth: '2014-06-12' });

  /* Properties */
  const flat = await make('properties', {
    name: 'Indiranagar Apartment', propertyType: 'APARTMENT', usage: 'SELF_OCCUPIED', addressLine1: '12, 4th Cross, Indiranagar', city: 'Bengaluru', state: 'Karnataka', postalCode: '560038',
    ownershipType: 'JOINT', ownerNames: 'Asha Rao, Vikram Rao', purchaseDate: '2018-03-15', purchaseValue: 14500000, currentValue: 19800000, valuationDate: day(-90), carpetAreaSqft: 1450, builtUpAreaSqft: 1780,
    registrationNumber: 'BLR-IND-2018-004512', propertyTaxId: 'PID-88-112-45', propertyTaxAmount: 14200, propertyTaxDueDate: day(40), propertyTaxFrequency: 'YEARLY',
    societyName: 'Lakeview Residents Association', societyMaintenanceAmount: 6500, parkingDetails: 'Basement B1 — slots 41 and 42',
    loanLender: 'HDFC Bank', loanPrincipal: 9000000, loanOutstanding: 5120000, loanEmi: 78500, loanEmiDay: 5, loanInterestRate: 8.6,
  });
  const farm = await make('properties', {
    name: 'Coorg Holiday Home', propertyType: 'FARMHOUSE', usage: 'RENTED_OUT', city: 'Madikeri', state: 'Karnataka', ownershipType: 'SOLE', ownerNames: 'Asha Rao',
    purchaseDate: '2021-11-02', purchaseValue: 8200000, currentValue: 9600000, tenantName: 'Hillside Stays LLP', monthlyRent: 42000, rentDueDay: 7, leaseStart: day(-200), leaseEnd: day(165),
  });
  const living = await make('rooms', { propertyId: flat.id, name: 'Living room', roomType: 'LIVING' });
  const kitchen = await make('rooms', { propertyId: flat.id, name: 'Kitchen', roomType: 'KITCHEN' });
  await make('rooms', { propertyId: flat.id, name: 'Master bedroom', roomType: 'BEDROOM' });
  await make('property-ownerships', { propertyId: flat.id, ownerName: 'Asha Rao', memberId: household.memberId, sharePercent: 50 });
  await make('property-ownerships', { propertyId: flat.id, ownerName: 'Vikram Rao', memberId: spouse.id, sharePercent: 50 });

  /* Accounts */
  const savings = await make('bank-accounts', { name: 'HDFC Savings', accountType: 'SAVINGS', institution: 'HDFC Bank', last4: '4821', currentBalance: 386000, holderMemberId: household.memberId });
  const card = await make('bank-accounts', { name: 'ICICI Credit Card', accountType: 'CREDIT_CARD', institution: 'ICICI Bank', last4: '9007', currentBalance: 42800, creditLimit: 400000, statementDay: 18, dueDay: 5 });

  /* Utilities and bills: a year of electricity history, plus current bills */
  const electricity = await make('bill-providers', { name: 'Electricity — Indiranagar', utilityType: 'ELECTRICITY', providerName: 'BESCOM', consumerNumber: '4455667788', billingCycle: 'MONTHLY', propertyId: flat.id });
  const water = await make('bill-providers', { name: 'Water — Indiranagar', utilityType: 'WATER', providerName: 'BWSSB', consumerNumber: 'E-221947', propertyId: flat.id });
  const broadband = await make('bill-providers', { name: 'Broadband', utilityType: 'BROADBAND', providerName: 'ACT Fibernet', accountNumber: '100234567', propertyId: flat.id, autopay: true });
  const gas = await make('bill-providers', { name: 'Piped gas', utilityType: 'GAS', providerName: 'GAIL Gas', consumerNumber: 'BLR0098812', propertyId: flat.id });
  const dth = await make('bill-providers', { name: 'DTH — Coorg', utilityType: 'DTH', providerName: 'Tata Play', accountNumber: '1188220045', propertyId: farm.id, billingCycle: 'PREPAID' });
  let reading = 18200;
  for (let m = -8; m <= -1; m++) {
    const units = 260 + ((m * 37) % 90 + 90) % 90;
    const due = `${month(m)}-17`;
    await make('bills', { providerId: electricity.id, billDate: `${month(m)}-02`, dueDate: due, amount: Math.round(units * 7.9), previousReading: reading, currentReading: reading + units, readingUnit: 'kWh', status: 'PAID', paidDate: `${month(m)}-14`, paymentMethod: 'UPI', bankAccountId: savings.id });
    reading += units;
    await make('bills', { providerId: broadband.id, dueDate: `${month(m)}-10`, amount: 1179, status: 'PAID', paidDate: `${month(m)}-09`, paymentMethod: 'CREDIT_CARD', bankAccountId: card.id });
  }
  const dueSoon = await make('bills', { providerId: electricity.id, billDate: day(-9), dueDate: day(4), amount: 2462, previousReading: reading, currentReading: reading + 312, readingUnit: 'kWh' });
  await make('bills', { providerId: water.id, dueDate: day(11), amount: 640 });
  await make('bills', { providerId: broadband.id, dueDate: day(6), amount: 1179 });
  const overdue = await make('bills', { providerId: gas.id, dueDate: day(-3), amount: 915 });
  await make('bills', { providerId: dth.id, dueDate: day(19), amount: 499 });

  /* Staff (before expenses so that salary entries exist for earlier months) */
  const cook = await make('staff', { name: 'Lakshmi', role: 'COOK', phone: '+91 90000 00001', monthlySalary: 14000, salaryDay: 1, joiningDate: '2022-04-01', paymentMethod: 'UPI', propertyId: flat.id, paidLeavesPerMonth: 2 });
  const driver = await make('staff', { name: 'Ramesh', role: 'DRIVER', phone: '+91 90000 00002', monthlySalary: 22000, salaryDay: 1, joiningDate: '2023-01-10', paymentMethod: 'BANK_TRANSFER', policeVerified: true });
  const housekeeper = await make('staff', { name: 'Sunita', role: 'HOUSEKEEPER', monthlySalary: 9000, salaryDay: 5, joiningDate: '2021-08-15', paymentMethod: 'CASH', propertyId: flat.id });
  for (let m = -4; m <= -1; m++) {
    for (const s of [cook, driver, housekeeper]) {
      await make('salaries', { staffId: s.id, month: month(m), baseAmount: s.monthlySalary, ...(m === -2 && s.id === cook.id ? { bonus: 2000 } : {}), status: 'PAID', paidDate: `${month(m + 1)}-02`, paymentMethod: s.paymentMethod });
    }
  }
  await client.post('/salaries/generate', { month: month(0) });
  await make('staff-advances', { staffId: housekeeper.id, date: day(-40), amount: 5000, reason: 'Medical expense', recoveredAmount: 2000 });
  for (let d = -6; d <= -1; d++) {
    await client.post('/attendance/mark', { date: day(d), entries: [{ staffId: cook.id, status: d === -3 ? 'PAID_LEAVE' : 'PRESENT' }, { staffId: driver.id, status: 'PRESENT' }, { staffId: housekeeper.id, status: d === -5 ? 'ABSENT' : 'PRESENT' }] });
  }

  /* Day-to-day expenses over the last six months */
  const merchants = [
    ['BigBasket order', 'BigBasket', 3200, 'UPI'], ['Weekly vegetables', 'Local market', 850, 'CASH'], ['Dinner out', 'Toit restaurant', 2800, 'CREDIT_CARD'],
    ['Swiggy order', 'Swiggy', 640, 'UPI'], ['School fees — term', 'Greenfield School', 48000, 'NET_BANKING'], ['Amazon order', 'Amazon', 2350, 'CREDIT_CARD'],
    ['Pharmacy', 'Apollo Pharmacy', 780, 'UPI'], ['Movie tickets', 'PVR', 1100, 'CREDIT_CARD'], ['Home loan EMI', 'HDFC Bank', 78500, 'NET_BANKING'],
  ];
  for (let m = -5; m <= 0; m++) {
    for (let i = 0; i < merchants.length; i++) {
      const [description, merchant, amount, paymentMethod] = merchants[i];
      if (description.startsWith('School') && (m + 6) % 3 !== 0) continue;
      const d = `${month(m)}-${String(3 + i * 3).padStart(2, '0')}`;
      if (d > day(0)) continue;
      await make('expenses', { date: d, description, merchant, amount: Math.round(amount * (1 + ((m * 7 + i * 13) % 11) / 50)), paymentMethod, bankAccountId: paymentMethod === 'CREDIT_CARD' ? card.id : savings.id, memberId: i % 3 === 0 ? spouse.id : household.memberId, ...(description.includes('EMI') ? { propertyId: flat.id, isRecurring: true, recurrence: 'MONTHLY' } : {}) });
    }
    await make('expenses', { date: `${month(m)}-07`, description: 'Rent received — Coorg Holiday Home', merchant: 'Hillside Stays LLP', amount: 42000, kind: 'INCOME', propertyId: farm.id, bankAccountId: savings.id });
  }
  await make('budgets', { name: 'Groceries', category: 'GROCERIES', period: 'MONTHLY', amount: 15000 });
  await make('budgets', { name: 'Eating out', category: 'DINING', period: 'MONTHLY', amount: 6000 });
  await make('budgets', { name: 'Total household', category: 'ALL', period: 'YEARLY', amount: 2400000 });

  /* Subscriptions */
  await make('subscriptions', { name: 'Netflix', category: 'OTT', plan: 'Premium', amount: 649, billingCycle: 'MONTHLY', nextRenewalDate: day(9), bankAccountId: card.id, lastUsedDate: day(-2) });
  await make('subscriptions', { name: 'Amazon Prime', category: 'OTT', amount: 1499, billingCycle: 'YEARLY', nextRenewalDate: day(120), lastUsedDate: day(-5) });
  await make('subscriptions', { name: 'Spotify Family', category: 'MUSIC', amount: 179, billingCycle: 'MONTHLY', nextRenewalDate: day(14), lastUsedDate: day(-1) });
  await make('subscriptions', { name: 'Google One 200 GB', category: 'CLOUD_STORAGE', amount: 1300, billingCycle: 'YEARLY', nextRenewalDate: day(200) });
  await make('subscriptions', { name: 'Gym membership', category: 'GYM', provider: 'Cult Fit', amount: 15000, billingCycle: 'YEARLY', nextRenewalDate: day(48), lastUsedDate: day(-95), memberId: spouse.id });

  /* Insurance */
  const carPolicy = await make('insurance-policies', { name: 'Car insurance — Creta', policyType: 'VEHICLE', insurer: 'ICICI Lombard', policyNumber: 'VEH-3001-99821', premiumAmount: 21400, sumInsured: 1150000, startDate: day(-340), expiryDate: day(25) });
  const health = await make('insurance-policies', { name: 'Family health floater', policyType: 'HEALTH', insurer: 'Star Health', policyNumber: 'P/141100/01/2026/004412', insuredMemberId: household.memberId, insuredNames: 'Asha, Vikram, Meera', premiumAmount: 38500, sumInsured: 1500000, startDate: day(-290), expiryDate: day(75), beneficiaries: 'Vikram Rao' });
  await make('insurance-policies', { name: 'Term life — Asha', policyType: 'TERM', insurer: 'HDFC Life', policyNumber: 'TL-20190044', insuredMemberId: household.memberId, premiumAmount: 26800, sumInsured: 20000000, startDate: '2019-07-01', expiryDate: '2049-07-01', nextPremiumDueDate: day(58), beneficiaries: 'Vikram Rao (100%)' });
  await make('insurance-policies', { name: 'Home insurance — Indiranagar', policyType: 'HOME', insurer: 'Bajaj Allianz', policyNumber: 'HOME-77-20045', propertyId: flat.id, premiumAmount: 7200, sumInsured: 12000000, startDate: day(-200), expiryDate: day(165) });

  /* Vehicles */
  const car = await make('vehicles', {
    name: 'Family SUV', vehicleType: 'CAR', make: 'Hyundai', model: 'Creta', variant: 'SX(O) Diesel', year: 2021, color: 'Polar White', registrationNumber: 'KA 03 MX 4521', fuelType: 'DIESEL',
    purchaseDate: '2021-09-20', purchasePrice: 1780000, currentOdometer: 41200, ownerMemberId: household.memberId, propertyId: flat.id, driverStaffId: driver.id, primaryDriverName: 'Ramesh',
    insurancePolicyId: carPolicy.id, insuranceExpiry: day(25), pucNumber: 'KA03PUC220981', pucExpiry: day(70), registrationExpiry: '2036-09-19', roadTaxAmount: 214000, roadTaxValidTill: '2036-09-19',
    serviceIntervalKm: 10000, serviceIntervalMonths: 12, fastagId: '34161FA820328E4812C0',
  });
  const scooter = await make('vehicles', { name: 'Scooter', vehicleType: 'SCOOTER', make: 'Honda', model: 'Activa 6G', year: 2022, registrationNumber: 'KA 03 JK 9087', fuelType: 'PETROL', purchasePrice: 92000, currentOdometer: 8600, insuranceExpiry: day(-6), pucExpiry: day(130) });
  let odo = 41200;
  for (let i = 0; i < 8; i++) {
    odo += 520 + ((i * 53) % 140);
    const qty = 36 + (i % 4) * 2;
    await make('fuel-logs', { vehicleId: car.id, date: day(-150 + i * 20), fuelType: 'DIESEL', quantity: qty, pricePerUnit: 89.4, totalCost: Math.round(qty * 89.4), odometer: odo, fullTank: i !== 3, station: 'HP — Old Madras Road', paymentMethod: 'CREDIT_CARD' });
  }
  await make('vehicle-services', { vehicleId: car.id, date: day(-110), serviceType: 'PERIODIC_SERVICE', description: '40,000 km service', odometer: 41900, serviceCentre: 'Advaith Hyundai', labourCost: 3200, partsCost: 5400, totalCost: 8600, partsReplaced: 'Engine oil, oil filter, air filter', paymentMethod: 'CREDIT_CARD' });
  await make('vehicle-services', { vehicleId: car.id, date: day(-45), serviceType: 'TYRES', description: 'Two front tyres replaced', odometer: 44100, serviceCentre: 'MRF Tyres & Service', totalCost: 15800, warrantyTill: day(685) });

  /* Appliances and maintenance */
  const ac = await make('appliances', { name: 'Living room AC', applianceType: 'AIR_CONDITIONER', manufacturer: 'Daikin', model: 'FTKF50', serialNumber: 'DKN-5521-88', propertyId: flat.id, roomId: living.id, purchaseDate: day(-700), purchasePrice: 52000, vendor: 'Croma', warrantyStart: day(-700), warrantyEnd: day(30), amcProvider: 'Daikin Care', amcEnd: day(95), amcCost: 3200, serviceIntervalMonths: 6, nextServiceDate: day(12), expectedLifeYears: 10, condition: 'GOOD' });
  const fridge = await make('appliances', { name: 'Refrigerator', applianceType: 'REFRIGERATOR', manufacturer: 'Samsung', model: 'RT42', propertyId: flat.id, roomId: kitchen.id, purchaseDate: '2014-05-10', purchasePrice: 38000, expectedLifeYears: 10, condition: 'FAIR', warrantyEnd: '2015-05-10' });
  await make('appliances', { name: 'Water purifier', applianceType: 'WATER_PURIFIER', manufacturer: 'Kent', propertyId: flat.id, roomId: kitchen.id, purchaseDate: day(-400), purchasePrice: 16500, warrantyEnd: day(330), nextServiceDate: day(-4), serviceIntervalMonths: 4 });
  await make('appliances', { name: 'Washing machine', applianceType: 'WASHING_MACHINE', manufacturer: 'Bosch', propertyId: flat.id, purchaseDate: day(-1100), purchasePrice: 34000, warrantyEnd: day(-370), extendedWarrantyEnd: day(360), condition: 'GOOD' });
  const electrician = await make('vendors', { name: 'Shiva Electricals', category: 'ELECTRICIAN', contactPerson: 'Shivakumar', phone: '+91 90000 00010' });
  const plumber = await make('vendors', { name: 'Aqua Plumbing Works', category: 'PLUMBER', phone: '+91 90000 00011' });
  const acService = await make('vendors', { name: 'CoolCare AC Services', category: 'AC_SERVICE', phone: '+91 90000 00012', gstin: '29ABCDE1234F1Z5' });
  await make('maintenance-tasks', { title: 'Kitchen sink leaking', category: 'PLUMBING', priority: 'HIGH', propertyId: flat.id, roomId: kitchen.id, dueDate: day(2), vendorId: plumber.id });
  await make('maintenance-tasks', { title: 'Overhead water tank cleaning', category: 'WATER_TANK', propertyId: flat.id, dueDate: day(20), isRecurring: true, recurrence: 'HALF_YEARLY', estimatedCost: 1800 });
  await make('maintenance-tasks', { title: 'Pest control treatment', category: 'PEST_CONTROL', propertyId: flat.id, dueDate: day(-2), isRecurring: true, recurrence: 'QUARTERLY', estimatedCost: 2400 });
  const fridgeRepair = await make('maintenance-tasks', { title: 'Refrigerator compressor repair', category: 'APPLIANCE', applianceId: fridge.id, propertyId: flat.id, status: 'COMPLETED', completedDate: day(-60), actualCost: 12500 });
  const acTask = await make('maintenance-tasks', { title: 'AC servicing before summer', category: 'AIR_CONDITIONING', applianceId: ac.id, propertyId: flat.id, status: 'SCHEDULED', dueDate: day(12), vendorId: acService.id });
  await make('work-orders', { taskId: acTask.id, title: 'Service 3 split ACs', vendorId: acService.id, status: 'SCHEDULED', quotationAmount: 2700, quotationDate: day(-3), scheduledAt: new Date(Date.now() + 12 * 86_400_000).toISOString() });
  await make('work-orders', { taskId: fridgeRepair.id, title: 'Replace compressor', vendorId: electrician.id, status: 'PAID', invoiceAmount: 12500, paidAmount: 12500, paidDate: day(-58), paymentMethod: 'UPI', rating: 4, review: 'Prompt, fixed in one visit.' });
  await make('warranties', { itemName: 'Mattress (king)', warrantyType: 'MANUFACTURER', provider: 'Sleepwell', endDate: day(1400) });

  /* Healthcare, shopping, assets, travel, smart home */
  const claim = await make('insurance-claims', { policyId: health.id, claimNumber: 'CLM-2026-88120', claimDate: day(-35), memberId: child.id, incidentDescription: 'Day-care procedure', claimedAmount: 46000, approvedAmount: 41500, status: 'APPROVED' });
  await make('medical-records', { memberId: child.id, recordType: 'HOSPITALISATION', date: day(-38), provider: 'Manipal Hospital', amount: 46000, claimId: claim.id, reimbursementStatus: 'CLAIMED' });
  await make('medical-records', { memberId: household.memberId, recordType: 'DIAGNOSTIC', date: day(-20), provider: 'Thyrocare', amount: 2400, reimbursementStatus: 'NOT_APPLICABLE', followUpDate: day(160) });
  await make('medical-records', { memberId: spouse.id, recordType: 'CONSULTATION', date: day(-12), provider: 'Apollo Clinic', doctorName: 'Dr. N. Iyer', amount: 900 });
  await make('purchases', { date: day(-25), itemName: 'Dining table (6 seater)', category: 'FURNITURE', merchant: 'Urban Ladder', orderNumber: 'UL-7781220', amount: 46500, paymentMethod: 'CREDIT_CARD', warrantyTill: day(340), propertyId: flat.id });
  await make('purchases', { date: day(-9), itemName: 'Running shoes', category: 'CLOTHING', merchant: 'Myntra', amount: 5200, returnStatus: 'REFUND_PENDING', refundAmount: 5200, returnDeadline: day(5), memberId: spouse.id });
  await make('purchases', { date: day(-4), itemName: 'Monthly groceries', category: 'GROCERY', merchant: 'DMart', amount: 7840, paymentMethod: 'DEBIT_CARD' });
  const jewellery = await make('assets', { name: 'Gold necklace set', assetType: 'JEWELLERY', ownerMemberId: household.memberId, purchaseDate: '2016-11-20', purchasePrice: 310000, currentValue: 720000, valuationDate: day(-120), locationNote: 'Bank locker — HDFC Indiranagar' });
  await make('asset-valuations', { assetId: jewellery.id, date: day(-30), value: 745000, valuer: 'Tanishq, MG Road' });
  await make('assets', { name: 'Automatic watch', assetType: 'WATCH', ownerMemberId: spouse.id, purchaseDate: '2020-02-14', purchasePrice: 185000, currentValue: 210000 });
  await make('assets', { name: 'Framed painting — S. Raza print', assetType: 'ART', propertyId: flat.id, purchasePrice: 65000 });
  await make('travel-bookings', { tripName: 'Goa — December', bookingType: 'FLIGHT', provider: 'IndiGo', bookingReference: 'PNR8K2', travellers: 'Asha, Vikram, Meera', startDate: day(32), endDate: day(37), origin: 'Bengaluru', destination: 'Goa', amount: 21600, paymentMethod: 'CREDIT_CARD' });
  await make('travel-bookings', { tripName: 'Goa — December', bookingType: 'HOTEL', provider: 'Taj Holiday Village', startDate: day(32), endDate: day(37), destination: 'Candolim', amount: 58000 });
  await make('travel-documents', { memberId: household.memberId, docType: 'PASSPORT', country: 'India', numberLast4: '4471', issueDate: '2017-04-02', expiryDate: day(150) });
  await make('smart-devices', { name: 'Front door camera', deviceType: 'CCTV', manufacturer: 'TP-Link', model: 'Tapo C210', propertyId: flat.id, integrationProvider: 'NONE' });
  await make('smart-devices', { name: 'Main door lock', deviceType: 'SMART_LOCK', manufacturer: 'Yale', propertyId: flat.id, integrationProvider: 'NONE' });

  /* Documents (plain-text samples so that extraction and search have something to read) */
  const upload = async (path, name, text, fields = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([text], { type: 'text/plain' }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    return client.upload(path, fd);
  };
  const deed = await upload('/documents/upload', 'sale-deed-indiranagar.txt', 'SALE DEED\nThis sale deed is executed at Bengaluru for the apartment at 12, 4th Cross, Indiranagar.\nRegistered at the Sub-Registrar office, Indiranagar. Registration number BLR-IND-2018-004512.\n(Demo text, not a real document.)', { title: 'Sale deed — Indiranagar apartment', propertyId: flat.id, tags: 'property,legal' });
  await upload('/documents/upload', 'car-insurance-policy.txt', 'ICICI Lombard\nMotor insurance policy schedule\nPolicy No: VEH-3001-99821\nSum insured: Rs. 11,50,000\nInsured vehicle KA 03 MX 4521\n(Demo text, not a real document.)', { title: 'Car insurance policy — Creta', vehicleId: car.id, expiryDate: day(25) });
  await upload('/documents/upload', 'ac-warranty-card.txt', 'Daikin\nWarranty card\nModel FTKF50 Serial DKN-5521-88\nWarranty period 24 months from date of purchase\n(Demo text, not a real document.)', { title: 'AC warranty card', applianceId: ac.id, expiryDate: day(30) });
  await upload('/inbox/upload', 'bescom-bill.txt', `Bangalore Electricity Supply Company Limited\nTAX INVOICE\nBill No: BES/2026/118822\nBill Date: ${day(-2).split('-').reverse().join('/')}\nConsumer No: 4455667788\nUnits consumed: 298 kWh\nAmount Payable: Rs. 2,354.00\nDue Date: ${day(14).split('-').reverse().join('/')}\n(Demo text, not a real bill.)`);
  await upload('/inbox/upload', 'croma-receipt.txt', `Croma Retail\nInvoice No: CR-99812\nDate: ${day(-6)}\nGrand Total: Rs. 12,490.00\nPayment received. Thank you!\n(Demo text, not a real receipt.)`);

  await client.post('/notifications/scan', {});

  console.error(`Demo household ready. Sign in as ${email} / ${password}`);
  console.log(JSON.stringify({ email, password, householdId: household.id, propertyId: flat.id, vehicleId: car.id, scooterId: scooter.id, applianceId: ac.id, staffId: cook.id, documentId: deed.id, dueBillId: dueSoon.id, overdueBillId: overdue.id }));
}

main().catch((err) => {
  console.error('Seeding failed:', err?.message ?? err, err?.issues ? JSON.stringify(err.issues) : '');
  process.exit(1);
});
