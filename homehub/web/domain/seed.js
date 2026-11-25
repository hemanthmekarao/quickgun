// Sample data so a new user (or a demo) sees a populated app. All dates are relative to today.
// Names/numbers are made up.
import { today, addDays, addMonths, thisMonth, shiftMonth } from '../core/util.js';

const d = (n) => addDays(today(), n);

export async function seedDemo(repo) {
  const make = (col, rows) => Promise.all(rows.map((r) => repo.create(col, r)));
  const ym = thisMonth();

  await make('bills', [
    { name: 'Electricity – this month', category: 'Electricity', provider: 'State Electricity Board', accountNo: '1234567890', amount: 2480, dueDate: d(3), repeat: 'Monthly', status: 'Unpaid', upiId: 'electricity@upi' },
    { name: 'Water bill', category: 'Water', provider: 'City Water Board', amount: 420, dueDate: d(-2), repeat: 'Monthly', status: 'Unpaid' },
    { name: 'Broadband', category: 'Internet', provider: 'FiberNet', amount: 999, dueDate: d(9), repeat: 'Monthly', status: 'Unpaid', payUrl: 'https://example.com/pay' },
    { name: 'Society maintenance (Q3)', category: 'Society maintenance', provider: 'Green Heights RWA', amount: 9000, dueDate: d(14), repeat: 'Quarterly', status: 'Unpaid' },
    { name: 'Property tax', category: 'Property tax', provider: 'Municipal Corporation', amount: 18500, dueDate: d(40), repeat: 'Yearly', status: 'Unpaid' },
    { name: 'Gas cylinder', category: 'Gas', provider: 'Gas Agency', amount: 910, dueDate: d(-20), repeat: 'None', status: 'Paid', paidOn: d(-21) },
  ]);
  await make('subscriptions', [
    { name: 'Netflix', type: 'Streaming', plan: 'Standard', cost: 499, billingCycle: 'Monthly', nextRenewal: d(6), paymentMethod: 'Credit card', status: 'Active' },
    { name: 'Hotstar', type: 'Streaming', plan: 'Super', cost: 899, billingCycle: 'Yearly', nextRenewal: d(120), paymentMethod: 'UPI', status: 'Active' },
    { name: 'DTH', type: 'Cable / DTH', plan: 'HD pack', cost: 450, billingCycle: 'Monthly', nextRenewal: d(2), paymentMethod: 'UPI', status: 'Active' },
  ]);
  await make('expenses', [
    { date: d(-1), amount: 1840, category: 'Groceries', merchant: 'Supermarket', paymentMode: 'UPI' },
    { date: d(-4), amount: 760, category: 'Restaurants', merchant: 'Dinner out', paymentMode: 'Credit card' },
    { date: d(-9), amount: 2300, category: 'Groceries', merchant: 'Monthly staples', paymentMode: 'UPI' },
    { date: d(-15), amount: 1200, category: 'Household', merchant: 'Hardware store', paymentMode: 'Cash' },
    { date: addDays(addMonths(today(), -1), 0), amount: 5200, category: 'Groceries', merchant: 'Monthly groceries', paymentMode: 'UPI' },
    { date: addDays(addMonths(today(), -2), 0), amount: 4100, category: 'Groceries', merchant: 'Monthly groceries', paymentMode: 'UPI' },
    { date: addDays(addMonths(today(), -3), 0), amount: 6400, category: 'Shopping', merchant: 'Clothes', paymentMode: 'Credit card' },
  ]);
  await make('invoices', [
    { vendor: 'Home Appliance Store', invoiceNo: 'INV-20418', date: d(-200), amount: 38990, taxAmount: 5948, category: 'Appliance purchase', status: 'Paid' },
    { vendor: 'Plumber & Co.', invoiceNo: '77', date: d(-5), amount: 3500, taxAmount: 0, category: 'Repair / service', status: 'Pending', dueDate: d(4) },
  ]);
  const [health] = await make('policies', [
    { type: 'Health', insurer: 'Sample Health Insurer', policyNo: 'H-102938', insured: 'Family floater', sumAssured: 1000000, premium: 24500, premiumFrequency: 'Yearly', startDate: d(-335), renewalDate: d(30) },
    { type: 'Term life', insurer: 'Sample Life Insurer', policyNo: 'T-5566', insured: 'Self', sumAssured: 10000000, premium: 14200, premiumFrequency: 'Yearly', renewalDate: d(160) },
  ]);
  await make('medical', [
    { date: d(-12), patient: 'Self', hospital: 'City Clinic', type: 'Consultation', amount: 800, claimStatus: 'Not claimed' },
    { date: d(-40), patient: 'Parent', hospital: 'General Hospital', type: 'Hospitalization', amount: 46000, claimStatus: 'Filed', claimAmount: 42000, policyId: health.id },
  ]);
  const [maid, cook] = await make('staff', [
    { name: 'Lakshmi', role: 'Maid', phone: '9000000001', monthlySalary: 4500, payDay: 1, status: 'Active', workingHours: 'Mon–Sat, 7–9am' },
    { name: 'Ramesh', role: 'Cook', phone: '9000000002', monthlySalary: 7000, payDay: 5, status: 'Active' },
  ]);
  await make('salaries', [
    { staffId: maid.id, month: shiftMonth(ym, -1), amount: 4500, bonus: 0, deduction: 0, paidOn: d(-28), mode: 'UPI' },
    { staffId: maid.id, month: ym, amount: 4500, bonus: 0, deduction: 0, paidOn: d(-24), mode: 'UPI' },
    { staffId: cook.id, month: shiftMonth(ym, -1), amount: 7000, bonus: 500, deduction: 0, paidOn: d(-25), mode: 'Cash' },
  ]);
  await make('documents', [
    { title: 'Sale deed – Flat 402', type: 'Sale deed', property: 'Flat 402, Green Heights', docNo: 'REG/2019/4471', issueDate: '2019-06-14', location: 'Bank locker' },
    { title: 'Rental agreement – parking', type: 'Rental agreement', property: 'Parking slot 17', expiryDate: d(45), location: 'Home safe' },
  ]);
  const [car, bike] = await make('vehicles', [
    { name: 'Swift', type: 'Car', make: 'Maruti', model: 'Swift VXi', regNo: 'KA01AB1234', fuelType: 'Petrol', insuranceExpiry: d(20), pucExpiry: d(60), nextServiceDate: d(12), nextServiceKm: 30000 },
    { name: 'Activa', type: 'Scooter', make: 'Honda', model: 'Activa 6G', regNo: 'KA05CD5678', fuelType: 'Petrol', insuranceExpiry: d(200), pucExpiry: d(-3) },
  ]);
  await make('vehicleServices', [
    { vehicleId: car.id, date: d(-170), type: 'Regular service', odometer: 24800, cost: 4200, garage: 'Authorised service centre', description: 'Oil, filters, wash' },
    { vehicleId: car.id, date: d(-60), type: 'Tyres', odometer: 27400, cost: 16000, garage: 'Tyre shop' },
  ]);
  await make('fuelLogs', [
    { vehicleId: car.id, date: d(-42), liters: 32, amount: 3300, odometer: 26800, fullTank: true, station: 'Fuel Station A' },
    { vehicleId: car.id, date: d(-28), liters: 30, amount: 3150, odometer: 27390, fullTank: true },
    { vehicleId: car.id, date: d(-14), liters: 31, amount: 3260, odometer: 27980, fullTank: true },
    { vehicleId: car.id, date: d(-2), liters: 29, amount: 3050, odometer: 28560, fullTank: true },
    { vehicleId: bike.id, date: d(-10), liters: 4, amount: 420, odometer: 9100, fullTank: true },
    { vehicleId: bike.id, date: d(-1), liters: 4.5, amount: 470, odometer: 9330, fullTank: true },
  ]);
  const [fridge, ro] = await make('appliances', [
    { name: 'Kitchen fridge', category: 'Refrigerator', brand: 'Samsung', model: 'RT34', location: 'Kitchen', purchaseDate: d(-200), price: 38990, warrantyEnd: d(165), serviceEveryMonths: 12, nextServiceDate: d(165), supportPhone: '1800000000' },
    { name: 'RO water purifier', category: 'Water purifier / RO', brand: 'Aqua', location: 'Kitchen', purchaseDate: d(-400), price: 14500, amcEnd: d(25), serviceEveryMonths: 6, nextServiceDate: d(8) },
    { name: 'Washing machine', category: 'Washing machine', brand: 'LG', location: 'Utility', purchaseDate: d(-900), price: 27000, warrantyEnd: d(-100) },
  ]);
  await make('applianceServices', [{ applianceId: ro.id, date: d(-175), type: 'Filter / cartridge change', cost: 1800, technician: 'Service partner', nextDueDate: d(8) }]);
  void fridge;
}
