"use client";

import { useEffect, useState } from "react";
import { useJsApiLoader, Autocomplete } from "@react-google-maps/api";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const PARTY_LOCATION = "Klostergut Fremersberg, 76530 Baden-Baden";
const GOOGLE_MAPS_API_KEY = "AIzaSyCb7QdIbcoMXKlB7eA-ZKFhuubJzbyF0Fs";
const libraries = ["places"];

const ACTIVE_DRIVER_COUNT = 2;
const BUFFER_MINUTES = 5;
const MAX_SEATS_PER_RIDE = 4;
const MAX_DISTANCE_KM = 8;

function getTotalSeats(guests = []) {
  return guests.reduce((total, guest) => total + (guest.personCount || 1), 0);
}

function getStatusText(status) {
  if (status === "open") return "Wartet auf Fahrer";
  if (status === "assigned") return "Fahrer ist unterwegs";
  if (status === "done") return "Fahrt erledigt";
  if (status === "cancelled") return "Fahrt storniert";
  return "Unbekannt";
}

function calculateDistanceKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function getAverageLocation(guests) {
  const list = guests.filter((g) => g.location);
  if (!list.length) return null;

  const total = list.reduce(
    (sum, g) => ({
      lat: sum.lat + g.location.lat,
      lng: sum.lng + g.location.lng,
    }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: total.lat / list.length,
    lng: total.lng / list.length,
  };
}

export default function GastPage() {
  const [name, setName] = useState("");
  const [personCount, setPersonCount] = useState(1);
  const [address, setAddress] = useState("");
  const [guestLocation, setGuestLocation] = useState(null);

  const [autocomplete, setAutocomplete] = useState(null);
  const [liveRide, setLiveRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [liveEtaMinutes, setLiveEtaMinutes] = useState(null);

  const [searchRideNumber, setSearchRideNumber] = useState("");
  const [searchName, setSearchName] = useState("");

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries,
  });

  useEffect(() => {
    const savedRideId = localStorage.getItem("guestRideId");
    if (!savedRideId) return;

    const unsubscribe = onSnapshot(doc(db, "rides", savedRideId), (snap) => {
      if (snap.exists()) setLiveRide({ id: snap.id, ...snap.data() });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!liveRide?.assignedDriver) return;

    const unsubscribe = onSnapshot(
      doc(db, "drivers", liveRide.assignedDriver),
      (snap) => {
        if (snap.exists()) setDriverLocation(snap.data().location || null);
      }
    );

    return () => unsubscribe();
  }, [liveRide?.assignedDriver]);

  async function calculateDrivingMinutes(origin, destination) {
    return new Promise((resolve, reject) => {
      const service = new window.google.maps.DistanceMatrixService();

      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: window.google.maps.TravelMode.DRIVING,
          unitSystem: window.google.maps.UnitSystem.METRIC,
        },
        (response, status) => {
          if (status !== "OK") return reject(status);

          const element = response.rows[0].elements[0];
          if (element.status !== "OK") return reject(element.status);

          resolve(Math.ceil(element.duration.value / 60));
        }
      );
    });
  }

  useEffect(() => {
    async function updateEta() {
      if (!liveRide || !driverLocation || liveRide.status !== "assigned") return;

      const firstGuest = liveRide.guests?.[0];
      if (!firstGuest?.location) return;

      try {
        const eta = await calculateDrivingMinutes(driverLocation, firstGuest.location);
        setLiveEtaMinutes(eta);
      } catch (error) {
        console.error(error);
      }
    }

    updateEta();
    const interval = setInterval(updateEta, 15000);
    return () => clearInterval(interval);
  }, [liveRide, driverLocation]);

  function findBestRide(openRides, newGuestLocation, newPersonCount) {
    let bestRide = null;
    let shortestDistance = Infinity;

    openRides.forEach((ride) => {
      const guests = Array.isArray(ride.guests) ? ride.guests : [];
      if (getTotalSeats(guests) + newPersonCount > MAX_SEATS_PER_RIDE) return;

      const distance = calculateDistanceKm(
        newGuestLocation,
        getAverageLocation(guests)
      );

      if (distance < shortestDistance && distance <= MAX_DISTANCE_KM) {
        shortestDistance = distance;
        bestRide = ride;
      }
    });

    return bestRide;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const numericPersonCount = Number(personCount);

    if (!name || !address) return alert("Bitte Name und Adresse eingeben.");
    if (!guestLocation) return alert("Bitte Adresse aus Google-Vorschlägen wählen.");
    if (numericPersonCount < 1 || numericPersonCount > 4) {
      return alert("Personenzahl muss zwischen 1 und 4 sein.");
    }

    try {
      const snap = await getDocs(collection(db, "rides"));
      const rides = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const openRides = rides.filter(
        (ride) =>
          ride.status === "open" &&
          Array.isArray(ride.guests) &&
          getTotalSeats(ride.guests) < MAX_SEATS_PER_RIDE
      );

      const oneWayMinutes = await calculateDrivingMinutes(PARTY_LOCATION, address);
      const guestId = crypto.randomUUID();

      const newGuest = {
        id: guestId,
        name,
        personCount: numericPersonCount,
        address,
        location: guestLocation,
        oneWayMinutes,
        registeredAt: Date.now(),
      };

      let assignedRide = findBestRide(openRides, guestLocation, numericPersonCount);

      if (assignedRide) {
        const updatedGuests = [...assignedRide.guests, newGuest];
        const maxOneWayMinutes = Math.max(
          ...updatedGuests.map((g) => g.oneWayMinutes || 10)
        );

        await updateDoc(doc(db, "rides", assignedRide.id), {
          guests: updatedGuests,
          totalSeats: getTotalSeats(updatedGuests),
          oneWayMinutes: maxOneWayMinutes,
          estimatedRideMinutes: maxOneWayMinutes * 2 + BUFFER_MINUTES,
        });

        assignedRide = {
          ...assignedRide,
          guests: updatedGuests,
          totalSeats: getTotalSeats(updatedGuests),
          estimatedRideMinutes: maxOneWayMinutes * 2 + BUFFER_MINUTES,
        };
      } else {
        const rideNumber = `Fahrt-${String(rides.length + 1).padStart(3, "0")}`;
        const estimatedRideMinutes = oneWayMinutes * 2 + BUFFER_MINUTES;

        const newRide = {
          rideNumber,
          guests: [newGuest],
          totalSeats: numericPersonCount,
          status: "open",
          assignedDriver: null,
          oneWayMinutes,
          estimatedRideMinutes,
          estimatedWaitingMinutes: 0,
          createdAt: Date.now(),
        };

        const ref = await addDoc(collection(db, "rides"), newRide);
        assignedRide = { id: ref.id, ...newRide };
      }

      const activeRides = rides.filter(
        (ride) => ride.status === "open" || ride.status === "assigned"
      );

      const totalQueueMinutes = activeRides.reduce(
        (total, ride) => total + (ride.estimatedRideMinutes || 20),
        0
      );

      const estimatedWaitingMinutes =
        Math.ceil(totalQueueMinutes / ACTIVE_DRIVER_COUNT) +
        (assignedRide.estimatedRideMinutes || 20);

      await updateDoc(doc(db, "rides", assignedRide.id), {
        estimatedWaitingMinutes,
      });

      localStorage.setItem("guestRideId", assignedRide.id);
      localStorage.setItem("guestId", guestId);
      localStorage.setItem("guestName", name);

      setLiveRide({
        ...assignedRide,
        estimatedWaitingMinutes,
      });

      setName("");
      setPersonCount(1);
      setAddress("");
      setGuestLocation(null);
    } catch (error) {
      console.error(error);
      alert("Fehler bei Berechnung oder Speicherung.");
    }
  }

  async function searchRide(e) {
    e.preventDefault();

    if (!searchRideNumber) return alert("Bitte Fahrtnummer eingeben.");

    const snap = await getDocs(collection(db, "rides"));
    const rides = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const foundRide = rides.find(
      (ride) =>
        ride.rideNumber.toLowerCase() === searchRideNumber.trim().toLowerCase()
    );

    if (!foundRide) return alert("Keine Fahrt gefunden.");

    localStorage.setItem("guestRideId", foundRide.id);
    if (searchName) localStorage.setItem("guestName", searchName);

    setLiveRide(foundRide);
  }

  async function cancelRide() {
    if (!liveRide) return;

    const guestId = localStorage.getItem("guestId");
    const guestName = localStorage.getItem("guestName") || searchName;

    const currentGuests = Array.isArray(liveRide.guests) ? liveRide.guests : [];

    const updatedGuests = currentGuests.filter((guest) => {
      if (guestId && guest.id) return guest.id !== guestId;
      if (guestName) return guest.name.toLowerCase() !== guestName.toLowerCase();
      return true;
    });

    if (updatedGuests.length === currentGuests.length) {
      return alert("Gast konnte nicht eindeutig gefunden werden. Bitte mit Name suchen.");
    }

    const newTotalSeats = getTotalSeats(updatedGuests);

    await updateDoc(doc(db, "rides", liveRide.id), {
      guests: updatedGuests,
      totalSeats: newTotalSeats,
      status: updatedGuests.length === 0 ? "cancelled" : liveRide.status,
    });

    localStorage.removeItem("guestRideId");
    localStorage.removeItem("guestId");
    localStorage.removeItem("guestName");

    setLiveRide(null);
    setLiveEtaMinutes(null);

    alert("Deine Anmeldung wurde storniert.");
  }

  if (!isLoaded) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        Lade Google Maps...
      </main>
    );
  }

  if (liveRide) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6 text-black">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-4">
          <h1 className="text-3xl font-bold">Dein Fahrstatus</h1>

          <p>Fahrt: <strong>{liveRide.rideNumber}</strong></p>
          <p>Status: <strong>{getStatusText(liveRide.status)}</strong></p>
          <p>Fahrer: <strong>{liveRide.assignedDriver || "Noch nicht zugeteilt"}</strong></p>

          {liveRide.status === "assigned" && (
            <p>
              Live-ETA:{" "}
              <strong>
                {liveEtaMinutes
                  ? `Fahrer ist ca. ${liveEtaMinutes} Minuten entfernt`
                  : "Wird berechnet..."}
              </strong>
            </p>
          )}

          <p>
            Personen in der Fahrt:{" "}
            <strong>{liveRide.totalSeats || getTotalSeats(liveRide.guests)}</strong> /{" "}
            {MAX_SEATS_PER_RIDE}
          </p>

          <p>
            Geschätzte Wartezeit: ca.{" "}
            <strong>{liveRide.estimatedWaitingMinutes || "?"} Minuten</strong>
          </p>

          <button
            className="w-full bg-red-600 text-white p-3 rounded-xl"
            onClick={cancelRide}
          >
            Fahrt stornieren
          </button>

          <button
            className="w-full bg-gray-200 text-black p-3 rounded-xl"
            onClick={() => {
              localStorage.removeItem("guestRideId");
              localStorage.removeItem("guestId");
              localStorage.removeItem("guestName");
              setLiveRide(null);
            }}
          >
            Andere Fahrt suchen / neu anmelden
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6 text-black">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-6">Geburtstagsfahrten</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              placeholder="Dein Name"
              className="w-full border p-3 rounded-xl text-black"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <select
              className="w-full border p-3 rounded-xl text-black"
              value={personCount}
              onChange={(e) => setPersonCount(e.target.value)}
            >
              <option value={1}>1 Person</option>
              <option value={2}>2 Personen</option>
              <option value={3}>3 Personen</option>
              <option value={4}>4 Personen</option>
            </select>

            <Autocomplete
              onLoad={(auto) => setAutocomplete(auto)}
              onPlaceChanged={() => {
                if (autocomplete) {
                  const place = autocomplete.getPlace();
                  setAddress(place.formatted_address || "");

                  if (place.geometry) {
                    setGuestLocation({
                      lat: place.geometry.location.lat(),
                      lng: place.geometry.location.lng(),
                    });
                  }
                }
              }}
            >
              <input
                type="text"
                placeholder="Deine Adresse"
                className="w-full border p-3 rounded-xl text-black"
              />
            </Autocomplete>

            <button type="submit" className="w-full bg-black text-white p-3 rounded-xl">
              Fahrt anmelden
            </button>
          </form>
        </div>

        <div className="border-t pt-6">
          <h2 className="text-xl font-bold mb-3">Fahrt suchen</h2>

          <form onSubmit={searchRide} className="space-y-3">
            <input
              type="text"
              placeholder="Fahrtnummer, z.B. Fahrt-010"
              className="w-full border p-3 rounded-xl text-black"
              value={searchRideNumber}
              onChange={(e) => setSearchRideNumber(e.target.value)}
            />

            <input
              type="text"
              placeholder="Dein Name für Stornierung"
              className="w-full border p-3 rounded-xl text-black"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
            />

            <button className="w-full bg-gray-800 text-white p-3 rounded-xl">
              Fahrt suchen
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}