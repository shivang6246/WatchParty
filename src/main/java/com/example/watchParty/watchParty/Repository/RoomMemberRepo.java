package com.example.watchParty.watchParty.Repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.example.watchParty.watchParty.Entity.Room;
import com.example.watchParty.watchParty.Entity.RoomMember;
import com.example.watchParty.watchParty.Enum.RoomRole;

@Repository
public interface RoomMemberRepo extends JpaRepository<RoomMember, Long> {

    Optional<RoomMember> findByUsernameAndRoom(String username, Room room);

    List<RoomMember> findByRoom(Room room);

    List<RoomMember> findByUsername(String username);

    boolean existsByUsernameAndRoom(String username, Room room);

    long countByRoom(Room room);

    Optional<RoomMember> findFirstByRoomOrderByJoinedAtAsc(Room room);

    List<RoomMember> findByRoomAndOnlineTrue(Room room);

    List<RoomMember> findByRoomAndRoomRole(Room room, RoomRole roomRole);
}
