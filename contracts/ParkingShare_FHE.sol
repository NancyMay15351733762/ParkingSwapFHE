// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ParkingShare_FHE is SepoliaConfig {
    struct EncryptedParkingSpot {
        uint256 spotId;
        euint32 encryptedLocation;
        euint32 encryptedAvailability;
        euint32 encryptedPricePerHour;
        euint32 encryptedSize;
        uint256 timestamp;
        address owner;
    }

    struct ParkingRequest {
        euint32 encryptedDesiredLocation;
        euint32 encryptedDesiredTime;
        euint32 encryptedMaxPrice;
    }

    struct MatchResult {
        euint32 encryptedMatchScore;
        ebool encryptedIsAvailable;
        euint32 encryptedFinalPrice;
    }

    uint256 public spotCount;
    mapping(uint256 => EncryptedParkingSpot) public encryptedSpots;
    mapping(uint256 => ParkingRequest) public parkingRequests;
    mapping(uint256 => MatchResult) public matchResults;

    mapping(uint256 => uint256) private requestToSpotId;
    
    event SpotRegistered(uint256 indexed spotId, address indexed owner, uint256 timestamp);
    event RequestSubmitted(uint256 indexed requestId);
    event MatchCompleted(uint256 indexed spotId, uint256 requestId);

    function registerParkingSpot(
        euint32 encryptedLocation,
        euint32 encryptedAvailability,
        euint32 encryptedPricePerHour,
        euint32 encryptedSize
    ) public {
        spotCount += 1;
        uint256 newId = spotCount;
        
        encryptedSpots[newId] = EncryptedParkingSpot({
            spotId: newId,
            encryptedLocation: encryptedLocation,
            encryptedAvailability: encryptedAvailability,
            encryptedPricePerHour: encryptedPricePerHour,
            encryptedSize: encryptedSize,
            timestamp: block.timestamp,
            owner: msg.sender
        });

        emit SpotRegistered(newId, msg.sender, block.timestamp);
    }

    function submitParkingRequest(
        euint32 encryptedDesiredLocation,
        euint32 encryptedDesiredTime,
        euint32 encryptedMaxPrice
    ) public returns (uint256) {
        uint256 requestId = spotCount + 1;
        
        parkingRequests[requestId] = ParkingRequest({
            encryptedDesiredLocation: encryptedDesiredLocation,
            encryptedDesiredTime: encryptedDesiredTime,
            encryptedMaxPrice: encryptedMaxPrice
        });

        findMatchingSpot(requestId);
        emit RequestSubmitted(requestId);
        return requestId;
    }

    function findMatchingSpot(uint256 requestId) private {
        ParkingRequest storage request = parkingRequests[requestId];
        
        for (uint256 spotId = 1; spotId <= spotCount; spotId++) {
            EncryptedParkingSpot storage spot = encryptedSpots[spotId];
            
            ebool locationMatch = FHE.lt(
                FHE.sub(request.encryptedDesiredLocation, spot.encryptedLocation),
                FHE.asEuint32(10)
            );
            
            ebool priceMatch = FHE.lte(
                spot.encryptedPricePerHour,
                request.encryptedMaxPrice
            );
            
            ebool timeMatch = FHE.eq(
                spot.encryptedAvailability,
                request.encryptedDesiredTime
            );
            
            matchResults[spotId] = MatchResult({
                encryptedMatchScore: FHE.select(
                    FHE.and(locationMatch, priceMatch),
                    FHE.select(
                        timeMatch,
                        FHE.asEuint32(100),
                        FHE.asEuint32(80)
                    ),
                    FHE.asEuint32(30)
                ),
                encryptedIsAvailable: FHE.and(
                    FHE.and(locationMatch, priceMatch),
                    timeMatch
                ),
                encryptedFinalPrice: FHE.select(
                    timeMatch,
                    spot.encryptedPricePerHour,
                    FHE.mul(spot.encryptedPricePerHour, FHE.asEuint32(2))
                )
            });
        }

        emit MatchCompleted(0, requestId);
    }

    function requestSpotDecryption(uint256 spotId) public {
        require(msg.sender == encryptedSpots[spotId].owner, "Not spot owner");
        
        EncryptedParkingSpot storage spot = encryptedSpots[spotId];
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(spot.encryptedLocation);
        ciphertexts[1] = FHE.toBytes32(spot.encryptedAvailability);
        ciphertexts[2] = FHE.toBytes32(spot.encryptedPricePerHour);
        ciphertexts[3] = FHE.toBytes32(spot.encryptedSize);
        
        FHE.requestDecryption(ciphertexts, this.decryptSpot.selector);
    }

    function decryptSpot(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        FHE.checkSignatures(requestId, cleartexts, proof);
        (uint32 location, uint32 availability, uint32 price, uint32 size) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32));
        // Process decrypted spot info as needed
    }

    function requestMatchDecryption(uint256 spotId, uint256 requestId) public {
        MatchResult storage result = matchResults[spotId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(result.encryptedMatchScore);
        ciphertexts[1] = FHE.toBytes32(result.encryptedIsAvailable);
        ciphertexts[2] = FHE.toBytes32(result.encryptedFinalPrice);
        
        FHE.requestDecryption(ciphertexts, this.decryptMatch.selector);
    }

    function decryptMatch(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        FHE.checkSignatures(requestId, cleartexts, proof);
        (uint32 score, bool available, uint32 price) = 
            abi.decode(cleartexts, (uint32, bool, uint32));
        // Process decrypted match results as needed
    }

    function getSpotCount() public view returns (uint256) {
        return spotCount;
    }
}