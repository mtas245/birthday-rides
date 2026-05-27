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

function calculateDistanceKm(locationA, locationB) {
  if (!locationA || !locationB) return Infinity;

  const earthRadiusKm = 6371;
  const dLat = ((locationB.lat - locationA.lat) * Math.PI) / 180;
  const dLng = ((locationB.lng - locationA.lng) * Math.PI) / 180;
  const lat1 = (locationA.lat * Math.PI) / 180;
  const lat2 = (locationB.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function getAverageLocation(guests) {
  const guestsWithLocation = guests.filter((guest) => guest.location);

  if (guestsWithLocation.length === 0) return null;

  const total = guestsWithLocation.reduce(
    (sum, guest) => ({
      lat: sum.lat + guest.location.lat,
      lng: sum.lng + guest.location.lng,
    }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: total.lat / guestsWithLocation.length,
    lng: total.lng / guestsWithLocation.length,
  };
}

function getStatusText(status) {
  if (status === "open") return "Wartet auf Fahrer";
  if (status === "assigned") return "Fahrer ist unterwegs";
  if (status === "done") return "Fahrt erledigt";

  return "Unbekannt";
}

export default function GastPage() {
  const [name, setName] = useState("");
  const [personCount, setPersonCount] = useState(1);
  const [address, setAddress] = useState("");
  const [guestLocation, setGuestLocation] = useState(null);

  const [result, setResult] = useState(null);
  const [liveRide, setLiveRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [liveEtaMinutes, setLiveEtaMinutes] = useState(null);

  const [autocomplete, setAutocomplete] = useState(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries,
  });

  useEffect(() => {
    const savedRideId = localStorage.getItem("guestRideId");

    if (!savedRideId) return;

    const unsubscribe = onSnapshot(doc(db, "rides", savedRideId), (snapshot) => {
      if (snapshot.exists()) {
        setLiveRide({
          id: snapshot.id,
          ...snapshot.data(),
        });
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!liveRide?.assignedDriver) return;

    const unsubscribe = onSnapshot(
      doc(db, "drivers", liveRide.assignedDriver),
      (snapshot) => {
        if (snapshot.exists()) {
          const driverData = snapshot.data();
          setDriverLocation(driverData.location || null);
        }
      }
    );

    return () => unsubscribe();
  }, [liveRide?.assignedDriver]);

  async function calculateDrivingMinutes(destinationAddress) {
    return new Promise((resolve, reject) => {
      const service = new window.google.maps.DistanceMatrixService();

      service.getDistanceMatrix(
        {
          origins: [PARTY_LOCATION],
          destinations: [destinationAddress],
          travelMode: window.google.maps.TravelMode.DRIVING,
          unitSystem: window.google.maps.UnitSystem.METRIC,
        },
        (response, status) => {
          if (status !== "OK") {
            reject(status);
            return;
          }

          const element = response.rows[0].elements[0];

          if (element.status !== "OK") {
            reject(element.status);
            return;
          }

          resolve(Math.ceil(element.duration.value / 60));
        }
      );
    });
  }

  async function calculateLiveEtaMinutes(driverLocation, destinationLocation) {
    return new Promise((resolve, reject) => {
      if (!driverLocation || !destinationLocation) {
        resolve(null);
        return;
      }

      const service = new window.google.maps.DistanceMatrixService();

      service.getDistanceMatrix(
        {
          origins: [driverLocation],
          destinations: [destinationLocation],
          travelMode: window.google.maps.TravelMode.DRIVING,
          unitSystem: window.google.maps.UnitSystem.METRIC,
        },
        (response, status) => {
          if (status !== "OK") {
            reject(status);
            return;
          }

          const element = response.rows[0].elements[0];

          if (element.status !== "OK") {
            reject(element.status);
            return;
          }

          resolve(Math.ceil(element.duration.value / 60));
        }
      );
    });
  }

  useEffect(() => {
    async function updateLiveEta() {
      if (!liveRide || !driverLocation) return;

      const firstGuest = liveRide.guests?.[0];

      if (!firstGuest?.location) return;

      try {
        const eta = await calculateLiveEtaMinutes(
          driverLocation,
          firstGuest.location
        );

        setLiveEtaMinutes(eta);
      } catch (error) {
        console.error("Live ETA Fehler:", error);
      }
    }

    updateLiveEta();

    const interval = setInterval(updateLiveEta, 15000);

    return () => clearInterval(interval);
  }, [liveRide, driverLocation]);

  function findBestRide(openRides, newGuestLocation, newPersonCount) {
    let bestRide = null;
    let shortestDistance = Infinity;

    openRides.forEach((ride) => {
      const guests = Array.isArray(ride.guests) ? ride.guests : [];
      const currentSeats = getTotalSeats(guests);

      if (currentSeats + newPersonCount > MAX_SEATS_PER_RIDE) {
        return;
      }

      const averageLocation = getAverageLocation(guests);

      const distance = calculateDistanceKm(newGuestLocation, averageLocation);

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

    if (!name || !address) {
      alert("Bitte Name und Adresse eingeben.");
      return;
    }

    if (
      !numericPersonCount ||
      numericPersonCount < 1 ||
      numericPersonCount > 4
    ) {
      alert("Bitte eine Personenanzahl zwischen 1 und 4 eingeben.");
      return;
    }

    if (!guestLocation) {
      alert("Bitte Adresse aus Google-Vorschlägen wählen.");
      return;
    }

    try {
      const ridesSnapshot = await getDocs(collection(db, "rides"));

      const rides = ridesSnapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      const openRides = rides.filter(
        (ride) =>
          ride.status === "open" &&
          Array.isArray(ride.guests) &&
          getTotalSeats(ride.guests) < MAX_SEATS_PER_RIDE
      );

      const oneWayMinutes = await calculateDrivingMinutes(address);

      const newGuest = {
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
          ...updatedGuests.map((guest) => guest.oneWayMinutes || 10)
        );

        const estimatedRideMinutes = maxOneWayMinutes * 2 + BUFFER_MINUTES;

        await updateDoc(doc(db, "rides", assignedRide.id), {
          guests: updatedGuests,
          totalSeats: getTotalSeats(updatedGuests),
          estimatedRideMinutes,
          oneWayMinutes: maxOneWayMinutes,
        });

        assignedRide = {
          ...assignedRide,
          guests: updatedGuests,
          totalSeats: getTotalSeats(updatedGuests),
          estimatedRideMinutes,
        };
      } else {
        const nextRideNumber = rides.length + 1;
        const rideNumber = `Fahrt-${String(nextRideNumber).padStart(3, "0")}`;

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

        const newRideRef = await addDoc(collection(db, "rides"), newRide);

        assignedRide = {
          id: newRideRef.id,
          ...newRide,
        };
      }

      const activeRides = rides.filter(
        (ride) => ride.status === "open" || ride.status === "assigned"
      );

      const totalQueueMinutes = activeRides.reduce((total, ride) => {
        return total + (ride.estimatedRideMinutes || 20);
      }, 0);

      const queueMinutes = Math.ceil(totalQueueMinutes / ACTIVE_DRIVER_COUNT);

      const estimatedWaitingMinutes =
        queueMinutes + (assignedRide.estimatedRideMinutes || 20);

      await updateDoc(doc(db, "rides", assignedRide.id), {
        estimatedWaitingMinutes,
      });

      localStorage.setItem("guestRideId", assignedRide.id);

      setResult({
        rideNumber: assignedRide.rideNumber,
        estimatedWaitingMinutes,
        oneWayMinutes,
        totalSeats: getTotalSeats(assignedRide.guests),
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

  if (!isLoaded) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Lade Google Maps...</p>
      </main>
    );
  }

  if (liveRide) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6 text-black">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md space-y-4">
          <h1 className="text-3xl font-bold">Dein Fahrstatus</h1>

          <p>
            Fahrt: <strong>{liveRide.rideNumber}</strong>
          </p>

          <p>
            Status: <strong>{getStatusText(liveRide.status)}</strong>
          </p>

          <p>
            Fahrer:{" "}
            <strong>{liveRide.assignedDriver || "Noch nicht zugeteilt"}</strong>
          </p>

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
            <strong>
              {liveRide.totalSeats || getTotalSeats(liveRide.guests)}
            </strong>{" "}
            / {MAX_SEATS_PER_RIDE}
          </p>

          <p>
            Geschätzte Wartezeit: ca.{" "}
            <strong>
              {liveRide.estimatedWaitingMinutes || "?"} Minuten
            </strong>
          </p>

          <button
            className="w-full bg-gray-200 text-black p-3 rounded-xl"
            onClick={() => {
              localStorage.removeItem("guestRideId");
              setLiveRide(null);
              setResult(null);
              setDriverLocation(null);
              setLiveEtaMinutes(null);
            }}
          >
            Neue Fahrt anmelden
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6 text-black">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6">Geburtstagsfahrten</h1>

        {!result ? (
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

            <button
              type="submit"
              className="w-full bg-black text-white p-3 rounded-xl"
            >
              Fahrt anmelden
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-xl font-semibold">Du bist angemeldet ✅</p>

            <p>
              Deine Fahrt: <strong>{result.rideNumber}</strong>
            </p>

            <p>
              Personen in dieser Fahrt: <strong>{result.totalSeats}</strong> /{" "}
              {MAX_SEATS_PER_RIDE}
            </p>

            <p>
              Fahrzeit einfach: ca. <strong>{result.oneWayMinutes} Minuten</strong>
            </p>

            <p>
              Geschätzte Wartezeit: ca.{" "}
              <strong>{result.estimatedWaitingMinutes} Minuten</strong>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}