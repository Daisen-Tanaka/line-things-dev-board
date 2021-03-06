const deviceUUIDSet = new Set();
const connectedUUIDSet = new Set();
const connectingUUIDSet = new Set();
const notificationUUIDSet = new Set();

let logNumber = 1;

function onScreenLog(text) {
  const logbox = document.getElementById('logbox');
  logbox.value += '#' + logNumber + '> ';
  logbox.value += text;
  logbox.value += '\n';
  logbox.scrollTop = logbox.scrollHeight;
  logNumber++;
}

window.onload = () => {
  liff.init(async () => {
    onScreenLog('LIFF initialized');
    renderVersionField();

    await liff.initPlugins(['bluetooth']);
    onScreenLog('BLE plugin initialized');

    checkAvailablityAndDo(() => {
      onScreenLog('Finding devices...');
      findDevice();
    });
  }, e => {
    flashSDKError(e);
    onScreenLog(`ERROR on getAvailability: ${e}`);
  });
}

async function checkAvailablityAndDo(callbackIfAvailable) {
  const isAvailable = await liff.bluetooth.getAvailability().catch(e => {
    flashSDKError(e);
    onScreenLog(`ERROR on getAvailability: ${e}`);
    return false;
  });

  if (isAvailable) {
    document.getElementById('alert-liffble-notavailable').style.display = 'none';
    callbackIfAvailable();
  } else {
    document.getElementById('alert-liffble-notavailable').style.display = 'block';
    setTimeout(() => checkAvailablityAndDo(callbackIfAvailable), 1000);
  }
}

// Find LINE Things device using requestDevice()
async function findDevice() {
  const device = await liff.bluetooth.requestDevice().catch(e => {
    flashSDKError(e);
    onScreenLog(`ERROR on requestDevice: ${e}`);
    throw e;
  });

  try {
    if (!deviceUUIDSet.has(device.id)) {
      deviceUUIDSet.add(device.id);
      addDeviceToList(device);
    } else {
      // TODO: Maybe this is unofficial hack > device.rssi
      document.querySelector(`#${device.id} .rssi`).innerText = device.rssi;
    }

    checkAvailablityAndDo(() => setTimeout(findDevice, 100));
  } catch (e) {
    onScreenLog(`ERROR on findDevice: ${e}\n${e.stack}`);
  }
}

// Add device to found device list
function addDeviceToList(device) {
  onScreenLog('Device found: ' + device.name);

  const deviceList = document.getElementById('device-list');
  const deviceItem = document.getElementById('device-list-item').cloneNode(true);
  deviceItem.setAttribute('id', device.id);
  deviceItem.querySelector(".device-id").innerText = device.id;
  deviceItem.querySelector(".device-name").innerText = device.name;
  deviceItem.querySelector(".rssi").innerText = device.rssi;
  deviceItem.classList.add("d-flex");
  deviceItem.addEventListener('click', () => {
    deviceItem.classList.add("active");
    try {
      connectDevice(device);
    } catch (e) {
      onScreenLog('Initializing device failed. ' + e);
    }
  });
  deviceList.appendChild(deviceItem);
}

// Select target device and connect it
function connectDevice(device) {
  onScreenLog('Device selected: ' + device.name);

  if (!device) {
    onScreenLog('No devices found. You must request a device first.');
  } else if (connectingUUIDSet.has(device.id) || connectedUUIDSet.has(device.id)) {
    onScreenLog('Already connected to this device.');
  } else {
    connectingUUIDSet.add(device.id);
    initializeCardForDevice(device);

    // Wait until the requestDevice call finishes before setting up the disconnect listner
    const disconnectCallback = () => {
      updateConnectionStatus(device, 'disconnected');
      device.removeEventListener('gattserverdisconnected', disconnectCallback);
    };
    device.addEventListener('gattserverdisconnected', disconnectCallback);

    onScreenLog('Connecting ' + device.name);

    const things = new ThingsDevBoard(device);
    things.connect().then(() => {
      updateConnectionStatus(device, 'connected');
      connectingUUIDSet.delete(device.id);

      //Check Version
      versionCheck(things);
      //Setup
      setup(things);
    }).catch(e => {
      flashSDKError(e);
      onScreenLog(`ERROR on gatt.connect(${device.id}): ${e}`);
      updateConnectionStatus(device, 'error');
      connectingUUIDSet.delete(device.id);
    });
  }
}

function notificationSwCallback(e) {
  const dataBuffer = new DataView(e.target.value.buffer);
  onScreenLog(`Notify SW ${e.target.uuid}: ${buf2hex(e.target.value.buffer)}`);
}

function notificationTempCallback(e) {
  const dataBuffer = new DataView(e.target.value.buffer);
  onScreenLog('Notify Temperature : ' + String(((dataBuffer.getInt8(0) << 8) + dataBuffer.getInt8(1)) / 100));
}

//Version Check
async function versionCheck(board) {
  const version = await board.deviceVersionRead();
  if (version > 1) {
    onScreenLog('Firmware Version : ' + version);
  } else {
    onScreenLog('Do not support this mode. Please update device firmware. Version : ' + version);
    window.alert('Do not support this mode. Please update device firmware');
  }
}

// Device initialize
async function setup(things) {
  await things.displayClear().catch(e => onScreenLog('display clear error'));
  await things.displayControl(0, 0).catch(e => onScreenLog('display control error'));
  await things.displayWrite("Hello world").catch(e => onScreenLog('display write error'));

  // Initial LED
  await things.ledWriteByte(0xff).catch(e => onScreenLog('LED write error')).catch(e => onScreenLog('led write error'));

  //Enable Notify
  await things.swNotifyEnable(3, 1, 100, notificationSwCallback).catch(e => onScreenLog('SW Notify set error'));
  await things.tempNotifyEnable(2000, notificationTempCallback).catch(e => onScreenLog('Temp Notify set error'));
}

// Setup device information card
function initializeCardForDevice(device) {
  const template = document.getElementById('device-template').cloneNode(true);
  const cardId = 'device-' + device.id;

  template.style.display = 'block';
  template.setAttribute('id', cardId);
  template.querySelector('.card > .card-header > .device-name').innerText = device.name;

  // Tabs
  ['write', 'read'].map(key => {
    const tab = template.querySelector(`#nav-${key}-tab`);
    const nav = template.querySelector(`#nav-${key}`);

    tab.id = `nav-${key}-tab-${device.id}`;
    nav.id = `nav-${key}-${device.id}`;

    tab.href = '#' + nav.id;
    tab['aria-controls'] = nav.id;
    nav['aria-labelledby'] = tab.id;
  })

  // Device disconnect button
  template.querySelector('.device-disconnect').addEventListener('click', () => {
    onScreenLog('Clicked disconnect button');
    device.gatt.disconnect();
  });

  // Remove existing same id card
  const oldCardElement = getDeviceCard(device);
  if (oldCardElement && oldCardElement.parentNode) {
    oldCardElement.parentNode.removeChild(oldCardElement);
  }

  document.getElementById('device-cards').appendChild(template);
  onScreenLog('Device card initialized: ' + device.name);
}

// Update Connection Status
function updateConnectionStatus(device, status) {
  if (status == 'connected') {
    onScreenLog('Connected to ' + device.name);
    connectedUUIDSet.add(device.id);

    const statusBtn = getDeviceStatusButton(device);
    statusBtn.setAttribute('class', 'device-status btn btn-outline-primary btn-sm disabled');
    statusBtn.innerText = "Connected";
    getDeviceDisconnectButton(device).style.display = 'inline-block';
    getDeviceCardBody(device).style.display = 'block';
  } else if (status == 'disconnected') {
    onScreenLog('Disconnected from ' + device.name);
    connectedUUIDSet.delete(device.id);

    const statusBtn = getDeviceStatusButton(device);
    statusBtn.setAttribute('class', 'device-status btn btn-outline-secondary btn-sm disabled');
    statusBtn.innerText = "Disconnected";
    getDeviceDisconnectButton(device).style.display = 'none';
    getDeviceCardBody(device).style.display = 'none';
    document.getElementById(device.id).classList.remove('active');
  } else {
    onScreenLog('Connection Status Unknown ' + status);
    connectedUUIDSet.delete(device.id);

    const statusBtn = getDeviceStatusButton(device);
    statusBtn.setAttribute('class', 'device-status btn btn-outline-danger btn-sm disabled');
    statusBtn.innerText = "Error";
    getDeviceDisconnectButton(device).style.display = 'none';
    getDeviceCardBody(device).style.display = 'none';
    document.getElementById(device.id).classList.remove('active');
  }
}


function getDeviceCard(device) {
  return document.getElementById('device-' + device.id);
}

function getDeviceCardBody(device) {
  return getDeviceCard(device).getElementsByClassName('card-body')[0];
}

function getDeviceStatusButton(device) {
  return getDeviceCard(device).getElementsByClassName('device-status')[0];
}

function getDeviceDisconnectButton(device) {
  return getDeviceCard(device).getElementsByClassName('device-disconnect')[0];
}

function getDeviceNotificationButton(device) {
  return getDeviceCard(device).getElementsByClassName('notification-enable')[0];
}

function renderVersionField() {
  const element = document.getElementById('sdkversionfield');
  const versionElement = document.createElement('p')
    .appendChild(document.createTextNode('SDK Ver: ' + liff._revision));
  element.appendChild(versionElement);
}

function flashSDKError(error) {
  window.alert('SDK Error: ' + error.code);
  window.alert('Message: ' + error.message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}
